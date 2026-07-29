const { DatabaseSync } = require('node:sqlite');

const databasePath = process.argv[2];
if (!databasePath) {
  console.error('缺少数据库路径');
  process.exit(2);
}

const database = new DatabaseSync(databasePath, { readOnly: true });
try {
  const usersTable = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get();
  if (!usersTable) {
    process.stdout.write('1');
  } else {
    const row = database.prepare('SELECT COUNT(*) AS count FROM users').get();
    process.stdout.write(Number(row.count) === 0 ? '1' : '0');
  }
} finally {
  database.close();
}
