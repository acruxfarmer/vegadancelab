if (process.env.VEGA_ENV !== 'development' || process.env.VEGA_EXTERNAL_EFFECTS !== 'disabled') {
  throw new Error('Vega development worker requires external effects disabled');
}
// Holds the approved worker deployment slot without processing jobs before setup.
console.log('Vega development worker waiting for verified foundation; jobs disabled');
const keepAlive = setInterval(() => {}, 60000);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { clearInterval(keepAlive); process.exit(0); });
}
