export default function handler(_req: any, res: any) {
  res.status(200).json({ ok: true, time: Date.now(), node: process.version });
}
