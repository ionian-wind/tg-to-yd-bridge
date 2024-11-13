import { resolve } from "node:path";
import { open as openDb } from 'lmdb';

export default openDb(resolve(process.cwd(), 'storage/local.database'), {
  compression: true,
});
