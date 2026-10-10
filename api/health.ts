export function GET(): Response {
  return Response.json({
    ok: true,
    app: "BUTCHER TRADER",
    mode: "DEMO_ONLY",
    liveTradingEnabled: false,
  });
}
