import { runMigrations, pool } from '../src/db/index.js';

runMigrations()
  .then(() => console.log('Migrations applied'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
