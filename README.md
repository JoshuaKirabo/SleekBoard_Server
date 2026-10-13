# SleekBoard Server

Express + MongoDB API for SleekBoard.

## Getting started

```
cp .env.example .env
npm install
npm run dev
```

The API listens on `PORT` (5000 by default). Hit `GET /api/health` to check it's up and talking to Mongo.

## Layout

```
src/
  server.js        boots the app once Mongo is connected
  app.js           express app, middleware, routes
  config/db.js     mongoose connection
  routes/          one file per resource, gathered in index.js
  controllers/     the handlers the routes point at
  middleware/      404 and error handling
  models/          mongoose schemas
```
