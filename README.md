# SleekBoard Server

Express + MongoDB API for SleekBoard.

## Getting started

Make a `.env` in this folder with `PORT`, `MONGODB_URI` and `CLIENT_URL` (one origin or a comma-separated list;
`localhost` also lets in `127.0.0.1` on the same port, and the other way round). The data goes in the `sleekboard` database. It's gitignored and never committed. Then:

```
npm install
npm run dev
```

The API listens on `PORT` (5050 by default; 5000 is taken by AirPlay on macOS). Hit `GET /api/health` to check it's up and talking to Mongo.

## Endpoints

```
GET    /api/health
GET    /api/logos/:domain      favicon proxy for colour sampling
GET    /api/jobs               every job, most recently touched first
POST   /api/jobs               add a job
PATCH  /api/jobs/:id           change some fields, e.g. { status } after a drag
DELETE /api/jobs/:id
POST   /api/jobs/extract       { url } -> what the listing says
```

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
  services/        work that isn't a request handler, like reading a job page
```
