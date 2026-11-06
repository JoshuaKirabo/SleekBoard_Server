// Whose data the server works on until sign-in exists: the one account named by OWNER_EMAIL in .env. Sign-in will
// replace this with the person signed in on each request. Looked up once, then remembered.
export class Owner
  {
    constructor({ db, email })
      {
        this.db = db;
        this.email = String(email || "").trim().toLowerCase();
        this.found = null;
      }

    id()
      {
        this.found ??= this.lookUp().catch((error) =>
          {
            // A failed lookup isn't remembered, so the next request tries again.
            this.found = null;
            throw error;
          });
        return this.found;
      }

    async lookUp()
      {
        if(!this.email) throw new Error("OWNER_EMAIL is missing from .env");
        const user = await this.db.user.findUnique({ where: { email: this.email }, select: { id: true } });
        if(!user) throw new Error(`No account for ${this.email} in Postgres yet. Run npm run db:copy -- --owner ${this.email}`);
        return user.id;
      }
  }
