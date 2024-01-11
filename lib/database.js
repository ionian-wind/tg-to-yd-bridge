import { open as openDb } from 'lmdb';

export default openDb({
  path: '../storage/local.database',
  compression: true,
});
