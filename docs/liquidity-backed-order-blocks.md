# Order block za swingovou likviditou — specifikace uživatele

Stav: implementovaný samostatný strukturní filtr nad platnými zónami.
Nejde o odhad pravděpodobnosti obchodu ani potvrzení čekajících příkazů.

## Demand

1. Cena vytvoří předchozí obchodní range.
2. Od výchozího order blocku přijde impulz vzhůru, který zavřením
   svíčky překoná horní hranici této range. Pouhý knot nestačí.
   Průraz celé range není totéž jako BOS libovolného drobného swingu.
3. Pozdější potvrzená swingová lows leží NAD demand order blockem.
   Při budoucím návratu shora by cena nejprve prošla pod těmito lows
   a potom vstoupila do order blocku. To je cenová proxy likvidity,
   nikoli změřený objem stop-lossů nebo záruka reakce.
4. Původní order block musí být stále platný. Pozdější zasažení alespoň
   25 % zvolené výšky jej podle stávajícího pravidla trvale vyřazuje.
5. Kandidátem není automaticky nejbližší malá pokračovací základna
   u aktuální ceny. Hledá se původ impulzu prorážejícího předchozí range.

## Supply

Zrcadlově: impulz zavře pod dolní hranicí předchozí range; pozdější
potvrzená swingová highs leží POD supply order blockem. Návrat zdola
by nejprve překonal highs a teprve potom dosáhl zóny.

## Časová a datová disciplína

- Range musí být definována před jejím průrazem, ne z budoucích svíček.
- Swing lze použít až po jeho potvrzení pravými svíčkami.
- Setup s pozdějšími swingy je známý až po jejich potvrzení, ne zpětně
  v čase původního order blocku. Neproběhlý sweep nelze hlásit jako hotový.
- Skutečný pozdější sweep je nutné odlišovat od očekávané cesty návratu.
- COT, sezonalita a makro zůstávají samostatným kontextem; nevytvářejí zónu.
- Žádné změny původních OHLCV ani syntetické doplňování mezer.
- Úroveň staré range, průraz, zdrojová svíčka a pozdější swingy mají být
  dohledatelné v detailu a grafu. Podmínky nesmí být skryté za jedním skóre.

## Potvrzené hranice a pracovní parametry

Uživatel potvrdil celé high–low včetně knotů. Nový strukturní setup proto
nepřijímá body-wick alternativu. Stávající 25% invalidace zůstává nadřazená.

Pracovní hodnoty, viditelně označené v aplikaci (ne schválené pravděpodobnosti):

- Okno nejvýše 96 předchozích svíček, volitelné 24/48/96; nejméně 24.
- Hranice range = skutečné maximum high a minimum low tohoto okna,
  určené výhradně před zdrojovou svíčkou. Šířka 2–12 výchozích ATR.
- Nejméně dva potvrzené swingy u obou hran (2 vlevo/2 vpravo).
- Tolerance k hranám i šířka pozdějšího shluku 0,5 ATR, volitelně 0,25/0,5/1.
- Od zdroje nejvýše tři odchodové svíčky pro close za celou range,
  bez mezilehlé protisměrné svíčky nebo nepřípustné časové mezery.
- Nejméně dva pozdější potvrzené swingy, mezi prvním a posledním alespoň
  pět svíček; pool mezi cenou a OB, nejvýše 2 ATR od OB (volitelně 1/2/3).
- Demand pool je nejnižší low shluku, supply nejvyšší high. Jakýkoli
  pozdější knot přísně za tuto úroveň znamená již vybraný shluk, ne čekající
  budoucí likviditu. Rovnost úrovně sama není průraz.
- Čas dostupnosti setupu = maximum potvrzení OB, průrazu a druhého či
  posledního použitého potvrzeného swingu. Setup nelze zpětně datovat k OB.

Výpočet nepřidává body BOS/volume ani procenta úspěšnosti. Shody mají
přednost při standardním řazení; samostatný filtr umožní zobrazit jen je.
Legacy platné zóny zůstávají dostupné. Graf kreslí historickou range,
close průrazu a swingový pool odděleně od order blocku a sezonního okna.

## Kontrola obrázku GBPCAD H4

Podmíněné přiřazení červeného kruhu: poslední červená svíčka
2026-09-25 17:00 UTC, OANDA:GBPCAD. Vyžaduje potvrzení uživatele.

- Open 1,87387; high 1,87482; low 1,87280; close 1,87284.
- Celé rozpětí: 1,87280–1,87482; 25% hranice zásahu shora: 1,874315.
- H4 2026-09-29 13:00 UTC má low 1,87424: zásah asi 28,71 %.
  Při současném high–low pravidle je tedy zóna již neplatná.
- Tělo: 1,87284–1,87387. Stejný pozdější knot do těla nedosáhl.
  To samo o sobě nepotvrzuje splnění ostatních podmínek setupu.
- Sousední červená 2026-09-25 13:00 UTC má celé rozpětí
  1,87116–1,87542 a tentýž pozdější knot znamená asi 27,70 %.

Ověřeno nad stávajícím SQL-backed H4 snapshotem. Tato úprava neprovádí
nový providerový sběr, SQL zápis ani změnu plánů. Ceny, objemy a denní
výpočty sezonality/COT se nemění.
