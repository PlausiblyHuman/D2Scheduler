// sharepoint/capture-crews.js  -- paste into the console on the D2BuildScheduler site, copy the
// printed JSON into tools/live-crews.json (keep the top-level shape: capturedAt, capturedFrom, note, crews, trades, crewTrades)
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const g = async u => (await (await fetch(site + u, { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' })).json()).value;
  const out = {
    capturedAt: new Date().toISOString().slice(0, 10), capturedFrom: site,
    note: 'Crew-Trades.CrewId and .TradeId are raw integer lookup ids: CrewId joins to Crews.Id, TradeId to Trades.Id.',
    crews: await g("/_api/web/lists/GetByTitle('Crews')/items?$select=Id,Title,CrewID,Unlimited,Active,Size&$top=200"),
    trades: await g("/_api/web/lists/GetByTitle('Trades')/items?$select=Id,Title,TradeCode&$top=200"),
    crewTrades: await g("/_api/web/lists/GetByTitle('Crew-Trades')/items?$select=Id,CrewId,TradeId&$top=500")
  };
  console.log(JSON.stringify(out, null, 1));
  return { crews: out.crews.length, trades: out.trades.length, crewTrades: out.crewTrades.length };
})();
