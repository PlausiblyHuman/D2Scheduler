(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const all = async u => { let out = [], next = site + u; while (next) { const d = await (await fetch(next, { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' })).json(); out = out.concat(d.value || []); next = d['odata.nextLink'] || null; } return out; };
  const out = {
    spt: await all("/_api/web/lists/GetByTitle('Sub-phase%20Template')/items?$select=Id,Title,SubPhaseNumber,Sequence,TradeId,DefaultCrew,DurationDays,BuildType,PhaseName&$top=500&$orderby=Id"),
    tpt: await all("/_api/web/lists/GetByTitle('Task%20Template')/items?$select=Id,Title,SubPhaseId,Sequence,BuildType&$top=2000&$orderby=Id"),
    trades: await all("/_api/web/lists/GetByTitle('Trades')/items?$select=Id,TradeCode&$top=200")
  };
  console.log(JSON.stringify(out));
  return { spt: out.spt.length, tpt: out.tpt.length, trades: out.trades.length };
})();
