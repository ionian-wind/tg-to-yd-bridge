import db from './database.js';

export default class User {
  id;
  data;

  constructor(id) {
    this.id = id;
    this.data = db.get(this.#dbKey) || {};
  }

  get #dbKey() {
    return `user:${this.id}`;
  }

  async add(values) {
    Object.assign(this.data, values);

    await db.transaction(() => {
      db.put(this.#dbKey, this.data);
      db.put('_index:users', [
        ...new Set(db.get('_index:users') || []).add(this.id),
      ]);
    });
  }

  static all() {
    return db.get('_index:users') || [];
  }
}
