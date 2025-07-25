const express = require('express')
const router = express.Router()
const secrets = require('../secrets')

// Keep original health check at root level
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' })
})

router.get('/status', (req, res) => {
  if (req.session && req.session.authenticated) {
    res.status(200).json({ status: 'Authenticated', authenticated: true })
  } else {
    res.status(200).json({ status: 'Unauthenticated', authenticated: false })
  }
})

// Login endpoint
router.post('/login', (req, res) => {
  const { password } = req.body
  if (password === secrets.password) {
    req.session.authenticated = true
    res.status(200).json({ message: 'Login successful', authenticated: true })
  } else {
    res.status(401).json({ error: 'Invalid password', authenticated: false })
  }
})

// Logout endpoint
router.get('/logout', (req, res) => {
  req.session = null // Clear the session
  res.status(200).json({ message: 'Logged out successfully', authenticated: false })
})

module.exports = router
