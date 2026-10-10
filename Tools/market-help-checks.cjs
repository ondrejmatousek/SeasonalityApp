const assert=require('node:assert/strict'),help=require('../wwwroot/js/market-help.js');
for(const label of ['Nejistota četnosti: 40–90 %','Podobný COT · 2016–2025','Oddělená kontrola · posledních 8 let',
    'Medián ceny','Prostředních 50 % výnosů','Typický pohyb proti směru','COT index','Market trend','Long','Short','Spread'])
    assert.ok(help.describe(label),`Missing explanation: ${label}`);
assert.ok(help.texts.uncertainty.includes('Není to 95% šance zisku'));
assert.ok(help.texts.cot.includes('ne šest posledních let'));
assert.ok(help.texts.bullish.includes('zpětný filtr'));
assert.equal(help.describe('Neznámá položka'),null);
console.log('Market help checks passed: terminology, uncertainty, COT sample distinction and retrospective filters.');
