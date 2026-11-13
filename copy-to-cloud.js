// Copies cloud-dump.sql (your local data) into the cloud MySQL database.
// Usage (run inside the backend folder):
//   node copy-to-cloud.js <host> <port> <user> <database>
// It asks for the password, so it is never saved anywhere.
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const mysql = require('mysql2/promise')

const [host, port, user, database] = process.argv.slice(2)
if (!host || !port || !user || !database) {
  console.log('Usage: node copy-to-cloud.js <host> <port> <user> <database>')
  process.exit(1)
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
rl.question('Cloud DB password: ', async (password) => {
  rl.close()
  const sql = fs.readFileSync(path.join(__dirname, 'cloud-dump.sql'), 'utf8')
  try {
    const conn = await mysql.createConnection({
      host, port: Number(port), user, password, database,
      ssl: { rejectUnauthorized: false }, multipleStatements: true,
    })
    await conn.query(sql)
    const [rows] = await conn.query('SELECT (SELECT COUNT(*) FROM blogs) AS blogs, (SELECT COUNT(*) FROM content_items) AS content')
    console.log('Done. Blogs:', rows[0].blogs, ' Content rows:', rows[0].content)
    await conn.end()
  } catch (err) {
    console.error('Failed:', err.message)
    process.exit(1)
  }
})
