import type { NextApiRequest, NextApiResponse } from "next";

type Data = { message: string } | { error: string };

export default function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  switch (req.method) {
    case "GET": {
      const name = (req.query.name as string) || "world";
      return res.status(200).json({ message: `Hello, ${name}!` });
    }
    case "POST": {
      const { name, greeting } = req.body;
      if (!name) {
        return res.status(400).json({ error: "name is required" });
      }
      return res.status(201).json({ message: `${greeting ?? "Hello"}, ${name}!` });
    }
    default:
      res.setHeader("Allow", ["GET", "POST"]);
      return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
}
