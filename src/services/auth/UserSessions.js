// Every browser one person is signed in on. Each is a row in the sessions table (connect-pg-simple), and passport
// keeps who it's for inside the row's json: sess.passport.user is the user's id (PassportSetup.rememberUser). Deleting
// the row signs that browser out on its next request. Immich's SessionRepository.invalidateAll does the same with
// its own session table.
export class UserSessions
  {
    constructor({ db })
      {
        this.db = db;
      }

    // How many rows went. A session nobody signed in to has no passport part, so it's never touched.
    endAll(userId)
      {
        return this.db.$executeRaw`delete from sessions where sess->'passport'->>'user' = ${userId}`;
      }
  }
