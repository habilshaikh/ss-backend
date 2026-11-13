const mysql = require('mysql2')
const dotenv = require('dotenv')

dotenv.config({ path: require('path').join(__dirname, '.env') })

// A pool reconnects on its own, which cloud databases need.
// Set DB_SSL=true for hosted MySQL (Aiven etc.); leave it unset for local XAMPP.
const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 5,
})

db.query('SELECT 1', (err) => {
  if (err) console.error('Database connection failed:', err.message)
  else console.log('MySQL connected')
})

module.exports = db
