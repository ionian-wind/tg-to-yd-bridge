import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';
import mime from 'mime-types';

import User from './lib/user.js';
import YandexApi from './lib/yandex.js';

const yandex = new YandexApi(
  process.env.YD_CLIENT_ID,
  process.env.YD_CLIENT_SECRET,
);

const whitelist = (process.env.TG_WHITELIST || '').split('|');
const bot = new TelegramBot(process.env.TG_BOT_TOKEN, { polling: true });

const setRefresh = () => {
  setTimeout(() => (async (userIds) => {
    for (const id of userIds) {
      const user = new User(id);

      if (user.data.refreshAt && Date.now() > user.data.refreshAt) {
        await yandex.authRefresh(user, user.data.ydTokens.refresh_token);
      }
    }
    setRefresh();
  })([...User.all()]).catch(console.error), 5000);
}

const authRequest = async (user) => await bot.sendMessage(
  user.id,
  `Для подключения Яндекс Диск нужно отправить в чат код подтверждения`,
  {
    reply_markup: {
      inline_keyboard: [
        [{
          text: 'Получить код подтверждения',
          url: await yandex.authLink(user),
        }],
      ],
    },
  },
)

const usersList = async (user) => {
  if (whitelist.includes(user.id.toString())) {
    await bot.sendMessage(
      user.id,
      ['Список пользователей:', ...User.all()].join('\n')
    );
  }
};

const commands = new Map([
  ['/auth', authRequest],
  ['/ls', usersList]
]);


const transferFile = async (user, msg, info, filePrefix) => {
  if (info.fileSize > 20971520) { // TODO: switch to local bot api server
    return await bot.sendMessage(user.id, `Файл ${info.fileName} больше 20 мегабайт, бот не может получать такие файлы`, {
      reply_to_message_id: msg.message_id,
    });
  }

  await bot.getFile(info.fileId)
    .then(async ({ file_path: filePath, ...fileData }) => {
      const [,fileName] = filePath.split('/');
      const fileNameReal = fileName ?? `${fileData.file_unique_id}.${mime.extension(info.fileMime)}`;

      const url = `https://api.telegram.org/file/bot${process.env.TG_BOT_TOKEN}/${filePath}`;

      const targetName = filePrefix
        ? `${filePrefix}_${fileNameReal}`
        : info.fileName ?? fileNameReal;

      const { message_id: msgId } = await bot.sendMessage(user.id, `Загружаю файл ${targetName}`, {
        reply_to_message_id: msg.message_id,
      });

      await yandex.transferFile(user, url, targetName)
        .then(() => bot.editMessageText(`Файл ${targetName} загружен`, {
          chat_id: user.id,
          message_id: msgId,
        }))
        .catch((err) => {
          console.error(err, { userId: user.id }, info);
          return bot.editMessageText(`Возникла ошибка! Файл ${targetName} не был загружен`, {
            chat_id: user.id,
            message_id: msgId,
          });
        });
    });
};

const uploadFilesFromMessage = async (user, msg) => {
  if (msg.photo) {
    const [{
      file_id: fileId,
      file_unique_id: fileName,
      file_size: fileSize,
    }] = msg.photo.toSorted((photoA, photoB) => photoB.file_size - photoA.file_size);

    await transferFile(user, msg, {
      fileName,
      fileId,
      fileSize,
    }, fileName);
  }

  for (const file of ['document', 'video', 'audio']) {
    if (msg[file]) {
      await transferFile(user, msg, {
        fileMime: msg[file].mime_type,
        fileName: msg[file].file_name,
        fileId: msg[file].file_id,
        fileSize: msg[file].file_size,
      });
    }
  }
};

const handler = async (msg) => {
  const user = new User(msg.chat.id);

  const command = msg.entities?.find(({ type }) => type === 'bot_command');

  if (command) {
    const commandText = msg.text.substring(command.offset, command.offset + command.length);

    const fn = commands.get(commandText);

    if (fn) {
      return await fn(user, msg);
    }
  }

  if (!yandex.isPermitted(user)) {
    if (!msg.text?.match(/^\d+$/)) {
      return await bot.sendMessage(user.id, `Подключите Яндекс Диск командой /auth, либо пришлите код подтверждения`);
    }

    await yandex.authApprove(user, msg.text);

    await bot.sendMessage(user.id, `Яндекс Диск подключен`);
  }

  await uploadFilesFromMessage(user, msg);
};

bot.on('message', (msg) => {
  if (process.env.REG_ALLOWED === 'true' || whitelist.includes(msg.chat?.id?.toString())) {
    handler(msg)
      .catch(console.error);
  } else if (msg.chat) {
    bot.sendMessage(
      msg.chat.id,
      'access denied'
    ).catch(console.error);
  }
});

setRefresh();

console.log('started');
