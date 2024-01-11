import { URL, URLSearchParams } from 'node:url';
import { v4 as uuid } from 'uuid';
import axios from 'axios';

import { encode } from './base64.js';
import { currentDateStr, minutesToMs, secondsToMs } from "./datetime.js";

export default class YandexApi {
  #clientId;
  #clientSecret;

  constructor(clientId, clientSecret) {
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
  }

  isPermitted(user) {
    return typeof user.data.ydTokens === 'object' && user.data.ydTokens !== null;
  }

  async authLink(user) {
    const deviceId = user.data.deviceId || uuid();

    await user.add({ deviceId, ydTokens: null, refreshAt: null });

    const url = new URL('/authorize', 'https://oauth.yandex.ru');

    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.#clientId,
      device_id: deviceId,
      force_confirm: 'yes',
    }).toString();

    return url.toString();
  }

  async #applyTokens(user, ydTokens) {
    const refreshAt = Date.now() + secondsToMs(ydTokens.expires_in) - minutesToMs(10);

    await user.add({ ydTokens, refreshAt });

    console.log('refresh planned for %s at %s', user.id, new Date(refreshAt));
  }

  async #tokensRequest(user, params) {
    const { data: ydTokens } = await axios.post('https://oauth.yandex.ru/token', {
      ...params,
      client_id: this.#clientId,
      client_secret: this.#clientSecret,
    },{
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${encode(`${this.#clientId}:${this.#clientSecret}`)}`,
      },
    });

    await this.#applyTokens(user, ydTokens);
  }

  async authApprove(user, code) {
    await this.#tokensRequest(user, {
      grant_type: 'authorization_code',
      code,
      device_id: user.data.deviceId,
    });
  };

  async authRefresh(user, refreshToken) {
    await this.#tokensRequest(user, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  async #diskRequest(user, method, params, path = '') {
    return axios.request({
      url: `https://cloud-api.yandex.net/v1/disk/resources${path}`,
      method,
      params,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `OAuth ${user.data.ydTokens.access_token}`,
      },
    }).then(({ data }) => {
      console.log(data);
      return data;
    });
  }

  async pathExists(user, path) {
    return await this.#diskRequest(user, 'get', {
      path: `app:/${path}`,
      fields: 'path,name',
    })
      .then(() => true)
      .catch(() => false);
  }

  async createFolder(user, path) {
    return await this.#diskRequest(user, 'put', {
      path: `app:/${path}`,
      fields: 'path,name',
    });
  }

  async initTodayFolder(user) {
    const dirname = currentDateStr();

    if (!await this.pathExists(user, dirname)) {
      await this.createFolder(user, dirname);
    }

    return dirname;
  }

  async #checkProgress(user, href) {
    return axios.request({
      url: href,
      method: 'get',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `OAuth ${user.data.ydTokens.access_token}`,
      },
    }).then(({ data }) => {
      if (data.status === 'in-progress') {
        return new Promise(resolve => setTimeout(resolve, 2000))
          .then(() => this.#checkProgress(user, href));
      }

      return data;
    });
  }

  async transferFile(user, url, file) {
    const dirname = await this.initTodayFolder(user);
    const path = `app:/${dirname}/${file}`;

    return await this.#diskRequest(user, 'post', {
      url,
      path,
    }, '/upload')
      .then(({ href }) => this.#checkProgress(user, href))
      .then(() => this.#diskRequest(user, 'get', {
        path,
        fields: 'path,name,public_url',
      }));
  }
}
