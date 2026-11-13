const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const jwt = require('jsonwebtoken')
const db = require('./db')

dotenv.config()

const app = express()
const uploadDir = path.join(__dirname, 'uploads')

app.use(cors())
app.use(express.json())
app.use('/uploads', express.static(uploadDir))

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir)
  },
  filename(req, file, cb) {
    const uniqueName = `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`
    cb(null, uniqueName)
  },
})

const upload = multer({ storage })

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.status(401).json({ message: 'Token missing' })
  }

  const token = authHeader.split(' ')[1]
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' })
    }

    req.user = decoded
    next()
  })
}

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body

  db.query(
    'SELECT * FROM admins WHERE username = ? AND password = ?',
    [username, password],
    (err, results) => {
      if (err) {
        return res.status(500).json({ message: err.message })
      }

      if (results.length === 0) {
        return res.status(401).json({ message: 'Invalid credentials' })
      }

      const admin = results[0]
      const token = jwt.sign(
        { id: admin.id, username: admin.username },
        process.env.JWT_SECRET,
        { expiresIn: '1d' },
      )

      res.json({ token, admin: { id: admin.id, username: admin.username } })
    },
  )
})

app.get('/api/blogs', (req, res) => {
  db.query('SELECT * FROM blogs ORDER BY created_at DESC', (err, results) => {
    if (err) {
      return res.status(500).json({ message: err.message })
    }

    res.json(results)
  })
})

app.get('/api/blogs/:slug', (req, res) => {
  db.query('SELECT * FROM blogs WHERE slug = ?', [req.params.slug], (err, results) => {
    if (err) {
      return res.status(500).json({ message: err.message })
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'Blog not found' })
    }

    res.json(results[0])
  })
})

app.post('/api/blogs', verifyToken, upload.single('image'), (req, res) => {
  const { title, short_description, content, status } = req.body
  const slug = slugify(title)
  const image = req.file ? `/uploads/${req.file.filename}` : null

  db.query(
    'INSERT INTO blogs (title, slug, short_description, content, image, status) VALUES (?, ?, ?, ?, ?, ?)',
    [title, slug, short_description, content, image, status || 'published'],
    (err, result) => {
      if (err) {
        return res.status(500).json({ message: err.message })
      }

      res.status(201).json({ message: 'Blog created', id: result.insertId })
    },
  )
})

app.put('/api/blogs/:id', verifyToken, upload.single('image'), (req, res) => {
  const { title, short_description, content, status } = req.body
  const slug = slugify(title)

  db.query('SELECT * FROM blogs WHERE id = ?', [req.params.id], (findErr, rows) => {
    if (findErr) {
      return res.status(500).json({ message: findErr.message })
    }

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Blog not found' })
    }

    const oldBlog = rows[0]
    const image = req.file ? `/uploads/${req.file.filename}` : oldBlog.image

    db.query(
      'UPDATE blogs SET title=?, slug=?, short_description=?, content=?, image=?, status=? WHERE id=?',
      [title, slug, short_description, content, image, status, req.params.id],
      (err) => {
        if (err) {
          return res.status(500).json({ message: err.message })
        }

        res.json({ message: 'Blog updated' })
      },
    )
  })
})

app.delete('/api/blogs/:id', verifyToken, (req, res) => {
  db.query('DELETE FROM blogs WHERE id = ?', [req.params.id], (err) => {
    if (err) {
      return res.status(500).json({ message: err.message })
    }

    res.json({ message: 'Blog deleted' })
  })
})

// ── Editable site content (services, team, FAQ, settings) ──
const CONTENT_COLLECTIONS = ['services', 'team', 'faq', 'settings', 'founder', 'leaders']

function checkCollection(req, res, next) {
  if (!CONTENT_COLLECTIONS.includes(req.params.collection)) {
    return res.status(404).json({ message: 'Unknown collection' })
  }
  next()
}

function cleanData(body) {
  const { id, ...data } = body || {}
  return JSON.stringify(data)
}

function initContent() {
  db.query(
    `CREATE TABLE IF NOT EXISTS content_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      collection VARCHAR(50) NOT NULL,
      data LONGTEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (collection, sort_order)
    )`,
    (createErr) => {
      if (createErr) return console.error('Content table error:', createErr.message)
      // Markers: each collection's defaults load only once, so deleted items never come back.
      // The plain '_seeded' marker came first and covers the original four collections.
      db.query("SELECT DISTINCT collection FROM content_items WHERE collection LIKE '\\_seeded%'", (findErr, rows) => {
        if (findErr) return console.error('Content seed error:', findErr.message)
        const done = new Set(rows.map((row) => row.collection))
        const legacy = ['services', 'team', 'faq', 'settings']
        const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seedContent.json'), 'utf8'))
        const values = []
        Object.entries(seed).forEach(([collection, items]) => {
          if (done.has(`_seeded:${collection}`) || (done.has('_seeded') && legacy.includes(collection))) return
          values.push([`_seeded:${collection}`, '{}', 0])
          items.forEach((item, i) => values.push([collection, JSON.stringify(item), i]))
        })
        if (values.length === 0) return
        db.query('INSERT INTO content_items (collection, data, sort_order) VALUES ?', [values], (err) => {
          if (err) console.error('Content seed error:', err.message)
        })
      })
    },
  )
}

initContent()

const imageUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
  },
})

app.post('/api/content-image', verifyToken, (req, res) => {
  imageUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ message: 'Image must be 5 MB or smaller' })
    if (!req.file) return res.status(400).json({ message: 'Please choose a JPG, PNG or WEBP image' })
    res.status(201).json({ path: `/uploads/${req.file.filename}` })
  })
})

app.get('/api/content/:collection', checkCollection, (req, res) => {
  db.query(
    'SELECT id, data FROM content_items WHERE collection = ? ORDER BY sort_order, id',
    [req.params.collection],
    (err, rows) => {
      if (err) return res.status(500).json({ message: err.message })
      res.json(rows.map((row) => ({ ...JSON.parse(row.data), id: row.id })))
    },
  )
})

app.post('/api/content/:collection', verifyToken, checkCollection, (req, res) => {
  db.query(
    `INSERT INTO content_items (collection, data, sort_order)
     SELECT ?, ?, COALESCE(MAX(sort_order), -1) + 1 FROM content_items WHERE collection = ?`,
    [req.params.collection, cleanData(req.body), req.params.collection],
    (err, result) => {
      if (err) return res.status(500).json({ message: err.message })
      res.status(201).json({ message: 'Added', id: result.insertId })
    },
  )
})

// Order is saved from the full list of ids, in the new order
app.put('/api/content/:collection/reorder', verifyToken, checkCollection, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : []
  if (ids.length === 0) return res.status(400).json({ message: 'ids required' })
  db.query(
    'UPDATE content_items SET sort_order = FIELD(id, ?) WHERE collection = ? AND id IN (?)',
    [ids, req.params.collection, ids],
    (err) => {
      if (err) return res.status(500).json({ message: err.message })
      res.json({ message: 'Order saved' })
    },
  )
})

app.put('/api/content/:collection/:id', verifyToken, checkCollection, (req, res) => {
  db.query(
    'UPDATE content_items SET data = ? WHERE id = ? AND collection = ?',
    [cleanData(req.body), req.params.id, req.params.collection],
    (err, result) => {
      if (err) return res.status(500).json({ message: err.message })
      if (result.affectedRows === 0) return res.status(404).json({ message: 'Not found' })
      res.json({ message: 'Saved' })
    },
  )
})

app.delete('/api/content/:collection/:id', verifyToken, checkCollection, (req, res) => {
  db.query(
    'DELETE FROM content_items WHERE id = ? AND collection = ?',
    [req.params.id, req.params.collection],
    (err) => {
      if (err) return res.status(500).json({ message: err.message })
      res.json({ message: 'Deleted' })
    },
  )
})

app.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`)
})
