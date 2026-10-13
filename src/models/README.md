Mongoose schemas live here, one file per model. Example:

```
import mongoose from "mongoose";

const boardSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

export const Board = mongoose.model("Board", boardSchema);
```
