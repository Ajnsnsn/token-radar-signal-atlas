/* The same category-based plan generator is used by board.json and this page.
   Budgets are user-selected ceilings, never live fee quotes or qualifying amounts. */
(function (root) {
  const routes = {
    curator: ['Curator vault', 'Check host vault, curator, asset caps and exit queue. Curator TVL is not a deposit product.', 'If a public vault names this curator and you qualify, deposit one accepted asset; save its address and receipt. Otherwise research only.', 'host/curator failure and borrower concentration'],
    allocator: ['Managed vault', 'Read strategy, manager powers, underlying venues, share pricing and redemption delay.', 'Use one public vault only if its strategy and exit are clear. Deposit one accepted asset and save shares received; skip leverage.', 'manager discretion and layered contracts'],
    lending: ['Supply only', 'Inspect the asset, utilization, oracle, withdrawal liquidity and collateral settings.', 'Supply one accepted asset to one market. Leave borrowing disabled; save the supply receipt and withdrawal quote.', 'contract failure, locked liquidity and depeg'],
    credit: ['Eligibility first', 'Read borrower disclosures, investor restrictions, minimum ticket, defaults and maturity.', 'If eligible and the minimum fits the ceiling, use a disclosed pool. Otherwise inspect a sample subscription without funding it.', 'borrower default and illiquid loan terms'],
    rwa: ['Eligibility first', 'Read issuer, KYC, investor restrictions, minimum, custody and redemption schedule.', 'If eligible and the minimum fits the ceiling, subscribe with one accepted asset through the verified flow. Otherwise stop at onboarding.', 'issuer/custodian failure and restricted exits'],
    dex: ['One useful swap', 'Check a supported liquid pair, token contracts, price impact and all-in quote.', 'Swap only if you need the output asset; cap slippage at 0.5% and reject poor quotes. Never round-trip volume for hypothetical points.', 'price impact, malicious assets and execution loss'],
    liquidity: ['Small LP pilot', 'Inspect pair, fee tier, range, liquidity and removal flow; understand impermanent loss.', 'If willing to hold both assets, split the ceiling across one standard or broad-range LP position. Save the position identifier.', 'impermanent loss and inactive ranges'],
    restaking: ['Collateral review', 'Check collateral, vault/operator, slashing exposure and unbonding period.', 'If the minimum fits, use one verified vault with one accepted asset; record its exit epoch. Never borrow the collateral.', 'slashing, operator failure and delayed exits'],
    staking: ['Delegation review', 'Read validator/pool, native asset, minimum, fees and unbonding time.', 'If a small delegation is supported, delegate up to the ceiling and save the receipt. Skip unsuitable minimums or locks.', 'validator penalties and native-asset volatility'],
    cdp: ['Debt-free route', 'Check collateral, oracle, stability fees and liquidation rules. Minting creates debt.', 'Use a documented debt-free vault if available. If use requires borrowing, use a simulator and keep this protocol research-only.', 'liquidation, depeg and oracle failure'],
    stable: ['Redemption check', 'Check reserves, issuer powers, mint asset, redemption fees and queue.', 'Only if useful and redeemable, mint or deposit one supported asset up to the ceiling; inspect the reverse quote first.', 'depeg, reserves and redemption restrictions'],
    basis: ['Strategy review', 'Read hedge venue, custody, funding dependence, leverage limits and exit terms.', 'Buy unleveraged shares only if the minimum fits and counterparty risks are acceptable. Otherwise inspect a sample position.', 'funding reversals, exchange risk and leverage'],
    derivatives: ['Practice route', 'Review collateral, liquidation, funding, settlement and regional access.', 'Use an official simulator/testnet for one open-and-close exercise. Real exposure requires an existing hedge need, never assumed points.', 'leverage, liquidation and funding loss'],
    prediction: ['Research first', 'Check jurisdiction, event wording, settlement oracle and maximum loss.', 'Use a practice interface to compare an order and exit quote. Keep real funds at zero unless you independently need the exposure.', 'binary loss, disputed settlement and illiquidity'],
    insurance: ['Coverage need', 'Read covered events, exclusions, deductible, claims process and premium.', 'Quote cover for an existing need. Buy only if useful within a separate insurance budget; otherwise keep the quote without paying.', 'exclusions, claim disputes and sunk premiums'],
    payments: ['Useful payment', 'Verify wallet/network, fees, receiver address and refund policy.', 'For a real payment need, send a minimal supported amount to an intended recipient; verify receipt before any larger use.', 'routing, custody and irreversible mistakes'],
    governance: ['Read-only start', 'Read eligibility, voting power and lock duration. Never buy a token merely to farm.', 'If already eligible, review one proposal and cast a reasoned vote. Otherwise retain a research note with no funds committed.', 'locks, governance capture and opportunity cost'],
    chain: ['Application discovery', 'Find a maintained wallet, explorer and documented app; TVL proves no distribution.', 'Use an official testnet for one normal app workflow if available. Mainnet needs a separately verified app; never bridge for assumed rewards.', 'bridge risk and no direct farm route'],
    yield: ['Vault pilot', 'Read yield source, asset, manager powers, fees, lock-up and withdrawals.', 'If a public unleveraged vault fits, deposit one supported asset and record shares and net asset value. Otherwise research only.', 'strategy losses, layered contracts and exit queues'],
    unknown: ['Research first', 'Identify the product, documentation, token status, access rules and withdrawal path.', 'Do not fund an undocumented workflow. Use an official demo or read-only account until the product and exit are verified.', 'unknown mechanics and insufficient evidence']
  };
  const types = [
    [/risk curator/i,'curator'], [/capital allocator/i,'allocator'],
    [/uncollateralized|OTC Marketplace/i,'credit'], [/^(rwa|cedefi)$/i,'rwa'],
    [/lending/i,'lending'], [/liquidity manager/i,'liquidity'], [/dexs|NFT Marketplace/i,'dex'],
    [/restak|collateral markets/i,'restaking'], [/staking/i,'staking'],
    [/cdp|collateral management/i,'cdp'], [/stable/i,'stable'], [/basis/i,'basis'],
    [/derivative|option|leveraged/i,'derivatives'], [/prediction/i,'prediction'],
    [/insurance/i,'insurance'], [/payment|card/i,'payments'],
    [/governance|locker/i,'governance'], [/^chain$|btc/i,'chain'], [/yield|^farm$|^indexes$/i,'yield']
  ];
  function planType(category) { return (types.find(([re]) => re.test(category || '')) || [null,'unknown'])[1]; }
  function farmPlan(row) {
    const type = row.planType || planType(row.category), route = routes[type] || routes.unknown;
    const chain = (row.chains || [])[0] || 'the documented network';
    const capital = ['unknown', 'derivatives', 'prediction', 'insurance', 'governance', 'chain'].includes(type) ? 0 : (row.tvl >= 50000000 ? 50 : 25);
    const gas = chain === 'Ethereum' || chain === 'Bitcoin' ? 20 : 5;
    const days = row.age !== null && row.age < 180 ? 14 : 30;
    const access = ['curator', 'rwa', 'credit', 'basis', 'unknown'].includes(type);
    const budget = capital ? `At most $${capital} at risk; fees capped at $${gas} total` : '$0 research / practice route';
    return {
      capital, gas, days, mode: access ? 'Access check first' : route[0],
      warning: `Risks: ${route[3]}. The snapshot establishes no reward, eligibility or launch.`,
      steps: [
        {title:'Verify the route', text:`For ${row.name} on ${chain}, locate official docs independently; verify contracts, current token status and rewards terms. Missing metadata is not proof of no token.`, cost:'$0', time:'10–15 min'},
        {title:route[0], text:route[1], cost:'$0', time:'15–20 min'},
        {title:capital ? 'Optional small pilot' : 'Practice or useful participation', text:route[2], cost:budget, time:'15–25 min, if available'},
        {title:'Observe, do not churn', text:`Log receipts, balances, fees and program terms. Check weekly for ${days} days; add no transactions just for activity. This observation window does not establish qualification.`, cost:'$0 checks; capital stays at risk', time:`5 min/week for ${days} days`},
        {title:'Test the exit', text:'Inspect the withdrawal or settlement flow before adding exposure. Close the pilot when practical; reconcile costs, respect lock-ups and revoke unused approvals. Stop if fees exceed the cap.', cost:capital ? `Within the same $${gas} fee ceiling; losses possible` : '$0 for research; separately budget any real use', time:'10–20 min plus documented exit delay'}
      ]
    };
  }
  root.AtlasPlans = { farmPlan, planType };
})(globalThis);
