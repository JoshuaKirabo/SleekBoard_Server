// One model on the ladder: what it's called, where it sits, what it costs and what it can do.
export class Model
  {
    constructor({ rung, name, id, priceIn, priceOut, abilities = [] })
      {
        this.rung = rung;
        this.name = name;
        this.id = id;
        this.priceIn = priceIn;
        this.priceOut = priceOut;
        this.abilities = abilities;
      }

    // Dollars for one reply. Every input token is counted at full price, even the repeated ones Together bills for
    // less, so the spending cap can guess high but never low.
    costOf({ input = 0, output = 0 })
      {
        return (input * this.priceIn + output * this.priceOut) / 1_000_000;
      }

    can(ability)
      {
        return this.abilities.includes(ability);
      }
  }
