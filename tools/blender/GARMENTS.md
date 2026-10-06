# Every garment, as buildable parts

KNOWLEDGE.md covers how to sew and drape anything in Blender. This file covers WHAT to sew: every garment type in the
owner's lists (men's and women's tops and bottoms) broken down into the same small set of building blocks.

1,500 garment names collapse into a few dozen constructions. A "Madras shirt", a "gingham shirt" and a "striped shirt"
are the same sewn garment with a different PNG. A "pique polo" and a "performance polo" are the same pattern with a
different fabric preset.

**How to read a catalogue line:**

> **name**: BODY / SHOULDER+SLEEVE / NECK+COLLAR / CLOSURE / LENGTH / HEM / FABRIC / extras · `TEX` = texture-only variant of the line above

- Numbers are starting points from pattern-making sources; calibrate every template with the measuring tools (§6 of
  KNOWLEDGE.md).
- Sources are listed at the end.

---

## Part 1: the grammar (building blocks)

### 1.1 Body blocks and fit (ease = garment girth − body girth, at the chest/bust unless noted)

| fit | knit tops | woven tops | jackets (over a shirt) | coats (over a jacket) |
|---|---|---|---|---|
| compression / second skin | −10 … −5 % (shrink in sim) | n/a | | |
| fitted / slim | 0 … +4 cm | +8 … +10 cm (darts or princess seams) | +10 cm | +12 cm |
| regular | +6 … +10 cm (our crew tee) | +15 … +20 cm | +14 … +18 cm | +20 cm |
| relaxed | +12 … +20 cm | +22 … +28 cm | +20 … +25 cm | +25 … +30 cm |
| oversized | +25 … +40 cm, dropped shoulder | +30 … +45 cm | +30 cm+ | +35 cm+ |
| boxy | width at the hem = width at the chest, short body, often dropped shoulder | same | | |

**Shaping:**
- straight side seams (men's default);
- shaped waist (women's default, or "fitted");
- bust/waist darts;
- princess seams (darts moved into long curved seams, from the armhole or shoulder over the apex to the waist);
- yoke (a dart turned into a horizontal panel: shirt back yoke, jeans back yoke);
- empire line (seam under the bust, a design line only);
- peplum (a flared strip, a quarter-to-full circle, sewn at the waist);
- A-line or trapeze (flares from the armpit);
- swing (more flare).

**Knit vs woven:**
- Knits stretch and can use zero or negative ease. They are finished with bands (rib) instead of facings.
- Wovens need ease, darts and closures to get on.
- In the sim: knits get low compression and shear; wovens get higher shear and compression (see Part 2).

### 1.2 Shoulder and sleeve systems (the biggest visual difference between tops)

| system | how it's built | in the sim |
|---|---|---|
| **set-in** | sleeve cap sewn into an armhole at the shoulder point; cap height 0.5–0.75 × armhole depth (shallow cap = sleeve stands out, knits/casual; deep = hangs close, tailored) | KNOWLEDGE §4, §8.1; cap length = armhole + 0–3 mm (knit) / +1–1.5 cm (woven, eased) |
| **drop shoulder** | shoulder extended past the shoulder point by 3–12 cm; the cap gets FLATTER by the amount dropped (the shoulder does the cap's work), cap ease 2–4 cm | the seam hangs on the upper arm; gives the oversized/boxy look |
| **raglan** | a diagonal seam from the underarm to the neckline (front starts about 3–6 cm down the neckline, back about 4–6 cm); the sleeve includes the shoulder; the armhole drops about 2.5 cm; 2-piece raglan has a shoulder seam (or a dart) | baseball tees, sweatshirts, trench coats, rash guards; the shoulder line follows the body naturally |
| **saddle** | a raglan with a strip running along the shoulder | knitwear (Guernsey, Aran) |
| **kimono / grown-on** | sleeve cut in one with the bodice; the shoulder raised about 1.5 cm, the sleeve angle pivoted; a gusset at the underarm for fitted versions | T-shaped garments: kimono, kaftan, dashiki, thobe base, many traditional tops |
| **dolman / batwing** | grown-on with a very deep underarm (the side seam curves out from the waist to the wrist); the further the curve sits from the armhole, the more "batwing" | huge underarm drape: needs self-collision and low bending |
| **two-piece (tailored)** | top sleeve + under sleeve; curved for the elbow (an L shape, pitch forward); elbow about 2.5 cm above the midpoint; sleeve head with a pad or sleeve-head strip | suits, blazers, coats; stiffer Bending group at the head |
| **sleeveless** | armhole finished with a band/binding/facing; deeper armhole for tanks/stringers | tank, singlet, A-shirt (ribbed), stringer (very deep armhole + narrow strap), racerback (straps meet at the upper back) |
| **straps** | spaghetti (5 mm), standard (1–2 cm), halter (round the neck), one-shoulder, off-shoulder/Bardot (elastic band across the upper arms), strapless (boned + 5–10 % negative ease at the top band) | pin or shrink the top band; strapless MUST be tight or it slides |

**Sleeve lengths** (from the shoulder point, men's M):

| length | value |
|---|---|
| cap | 5–8 cm |
| short | 20–25 cm |
| elbow | 35 cm |
| ¾ | 45 cm |
| long | wrist + 2–3 cm (cut +8 %: it bunches at the elbow) |
| extra-long / thumbhole | +8–10 cm |

**Sleeve shapes:**
- volume added by slash-and-spread at the cap, the hem or both;
- the hem gathered into a cuff for bishop/lantern;
- gathering ratio 1.5–2.5×.

| shape | how it's made |
|---|---|
| straight / tapered | the base sleeve |
| bell | flare from the elbow down, straight open hem |
| bishop | fitted cap, wide lower sleeve gathered into a cuff |
| puff | gathered at the cap (and/or the hem) |
| lantern | fitted at the wrist and upper arm, ballooning between them (a horizontal seam) |
| flutter / butterfly | a short circular flounce |
| leg-of-mutton | volume at the top only |
| balloon | volume over the whole length, gathered at both ends |
| cap sleeve | a tiny extension |
| petal / tulip | two overlapping cap pieces |
| cold-shoulder | a cut-out at the shoulder |
| cowl sleeve | extra fabric draped on the bias |

**Cuffs:**
- open hem (turned 2–2.5 cm);
- rib cuff (70–85 % of the opening, 5–8 cm);
- shirt cuff (stiff band, wrist + 2.5–4 cm overlap, barrel/French; French = double length folded back, cufflinks);
- roll-up tab (military shirt);
- elastic casing;
- thumbhole.

### 1.3 Necklines

| neckline | how it's made |
|---|---|
| crew | front drop 6 cm (man) / 7.5 cm (woman), back 2.2 cm, rib band 70–88 % |
| scoop | lower and wider: front 10–15 cm |
| V | straight lines to the CF point; front 12–20 cm; mitred band |
| boat / bateau | wide (to near the shoulder point), shallow front ≈ back |
| square | looks square on the body, drafted with angled corners |
| sweetheart | two curves meeting in a dip at the CF (needs a fitted bodice) |
| cowl | extra fabric folded on the bias, draping in soft folds (bias cut, low bending) |
| mock neck | a short stand 3–5 cm; turtleneck/roll neck: a tall tube 15–25 cm folded down; funnel: a tall stand cut in one with the body |
| henley | crew band + a partial placket 8–13 cm with 2–5 buttons |
| keyhole | a slit or teardrop at the CF |
| plunge | a very deep V (needs anchoring) |
| halter / choker / asymmetric / one-shoulder | as named |
| split / notch neck | a short CF slit |

**Finish:** a knit rib band (70–88 %), self binding, a facing (wovens; clean sharp shapes), a bias binding, or a collar.

GarmentCode's neckline set (reusable shapes for a half neckline): CircleNeck, CurvyNeck, VNeck, SquareNeck,
TrapezoidNeck, CircleArcNeck, Bezier2Neck, each with width, front/back depth and angle 70–110°.

### 1.4 Collars

| collar | build | stand / fall |
|---|---|---|
| **shirt collar + stand** | a separate stand band (inner edge = neckline length) + a fall sewn on top; interfaced | stand 2.5–3.5 cm, fall 4–4.8 cm (the fall must cover the stand's seam) |
| point / spread / cutaway / club / tab / pin / button-down | the same build; only the fall's tip shape changes (point angle: point narrow, spread wide, cutaway very wide, club rounded; tab and pin hold the points under the tie; button-down has buttons at the tips) | |
| wing collar | a stand with small folded wing tips (formal) | |
| band / mandarin / grandad | the stand only, no fall; mandarin meets at the CF; Nehru/Mao/bandhgala on jackets | 2.5–4 cm |
| **camp / Cuban / convertible / revere** | a one-piece collar with a flat lapel roll, no stand, open neck | |
| **polo collar** | a flat-knit rib collar (a straight strip) on a partial placket | |
| **Johnny collar** | a polo collar with no buttons, a short V-placket | |
| **rugby collar** | a woven (twill) shirt collar on a knit body + a long placket | |
| **Peter Pan** | a flat collar following the neckline, rounded ends | |
| **sailor (middy)** | a flat collar, a big square at the back, a V at the front | |
| **notched lapel** (suit) | a collar + a lapel (part of the front, folded back along the roll line), the notch where they meet; peak lapel = points upward; break point at the top button | stand about 2.5 cm, fall about 4.5 cm |
| **shawl collar** | the collar + lapel in one continuous curve, no notch (tuxedo, shawl cardigan) | |
| **hood** | two (or three, with a centre strip) panels | height = head-to-shoulder + 5 cm; width = ½ head girth + 5 cm; neck edge = neckline length |
| **stand-up / funnel / mock** | a tall stand, often in one with the body (track tops, puffers, anoraks) | |
| **rib collar** (bomber, varsity) | a rib-knit band | |
| **jabot / pussy-bow / tie-neck** | a long strip tied at the neck | |
| **cowl** | see necklines | |
| **dongjeong / git** (hanbok), **eri** (kimono) | a band around a crossover neckline | |

**In the sim:** collars and stands get a Bending group (interfacing: stand 20–40× the fabric, fall 5–10×). Lapels need
the front left unsewn above the break and the roll line given a dihedral fold target (XPBD) or pinned briefly.

### 1.5 Closures and fronts

| closure | build |
|---|---|
| pullover | none |
| partial placket | henley, polo, popover, half-zip (zip 18–25 cm), quarter-zip (12–15 cm) |
| full button placket | 3.5–3.8 cm wide (stiff); buttons 8–9 cm apart; men's buttons on the right, women's on the left; covered/hidden placket (fly front) for dress/tux |
| snaps | western shirts (pearl snaps), track tops, baby/sport |
| zip | jackets, hoodies, fleece; a zip garage at the top; a storm flap over it on parkas/anoraks |
| double-breasted | wide overlap (about 8–15 cm extension past CF), 2 rows of buttons on either side of the CF |
| wrap / surplice | one front crosses over the other; a tie at the waist or side; surplice = the crossover sewn down (stable) |
| open front | cardigans, kimono jackets, robes, waterfall cardigans (no closure, the front hangs in folds) |
| ties | goreum (hanbok), obi (kimono belt), drawstrings (hoods, joggers, anoraks) |
| toggles | duffle coat; frogs (tang jacket, changshan) |
| lace-up | corset tops, ghillie shirts |

**In the sim:**
- Sew closed only at the buttons (one short seam per button) if it is worn closed.
- Leave an open front free and pin the back neck.
- Buttons, snaps and zips are anchored 3D objects or texture detail.

### 1.6 Hems and lengths (tops)

**Length landmarks:**
- crop: above the navel, about the waist − 5 cm;
- waist;
- high hip;
- hip: a regular men's tee is 70–74 cm from the HPS (size M);
- longline: hip + 8–12 cm;
- tunic: mid-thigh;
- knee, midi (mid-calf), maxi (ankle), floor.

**Hem types:**
- straight turned hem (2–2.5 cm, twin-needle on knits);
- curved shirttail (front/back dip 5–8 cm at the CF/CB, side seams higher);
- split hem (side vents 5–10 cm);
- high-low (back longer by 5–15 cm);
- handkerchief (points);
- asymmetric;
- rib band (sweatshirts, bombers: 85–90 % of the hem, gathers the body in = blouson);
- drawcord hem (anoraks, parkas);
- elastic;
- knot / twist front;
- peplum;
- tiered.

**In the sim:** turned hems = a heavier/stiffer strip (Property Weights: Bending + mass) so the hem hangs straight. Rib
hems = a shorter band piece sewn on, so the body blouses over it.

### 1.7 Bottoms: waist systems

| waist | build |
|---|---|
| fitted waistband | waist + 4 cm overlap, 4 cm finished (cut 10, folded), belt loops 5–7 |
| curved / contour waistband | jeans, low rise; GarmentCode FittedWB |
| elastic casing | joggers, pyjamas, pull-on (elastic = waist − 5–10 cm) |
| drawstring | through a casing or eyelets |
| paperbag | gathered high, a ruffle above the band, belted/tied |
| Hollywood waist | an extended high band, no loops |
| side adjusters / Gurkha | buckled tabs, the Gurkha's crossover band |
| yoke | a fitted hip panel instead of darts (jeans back, some skirts) |
| wrapper / sarong | no waistband: tied or tucked (§1.11) |

**Rise:** low (about 18–20 cm front), mid (23–25), high (28+). GarmentCode `rise` 0.5–1 scales the waist position
toward the crotch.

### 1.8 Trouser and leg blocks

**Crotch:**
- extension front = 10–12 % of ¼ seat, back = 30–35 % (about 3× the front);
- GarmentCode: front extension = front hip / 4, minimum extension = leg girth − hips/2 + 5 cm;
- rise ease 3 cm (men), 2 cm (women).

**Seat/thigh ease:** compression −10 %, leggings −5…−10 %, skinny 0–2 cm, slim 2.5–4, regular 5–7.5, relaxed 10–15,
baggy 20+.

**Leg shapes** (half hem width at the ankle, men's):

| leg | half hem width |
|---|---|
| skinny | 14–16 cm |
| slim | 18–19 |
| straight | 20–22 |
| relaxed | 22–24 |
| wide | 24–28 |
| palazzo | 30+ |
| bootcut | knee narrowest, hem +2–4 cm |
| flare / bell | knee narrow, hem +6–15 cm |
| kick flare | a cropped flare |
| tapered / pegged | full at the hip (pleats), narrow at the hem |
| barrel / balloon | wide at the knee, in at the hem (a curved outseam) |
| harem / drop crotch | the crotch dropped 15–40 cm (a deep U), cuffed |
| jogger | tapered to a rib/elastic ankle |
| stirrup | a strap under the foot |

**Pleats at the front:** flat front; single pleat (3–4 cm); double pleat (+2–3 cm second). Pleats add hip ease and a
fuller thigh.

**Lengths:**
- shorts: 5", 7", 9", 11" inseam; Bermuda = just above the knee; Gurkha = high waist + wide leg;
- capri / ¾: mid-calf;
- cropped / ankle: ankle − 3–5 cm;
- full: floor − 1–3 cm at the back;
- stacked: extra length bunching at the ankle;
- plus-fours / knickerbockers: gathered into a band below the knee (+4" / +2" overhang).

**Jeans construction:**
- front with a scoop pocket + coin pocket + fly (zip or buttons), 2 back panels + a V back yoke (an exploded dart),
  2 patch pockets;
- curved waistband, 5–7 belt loops;
- flat-felled inseam, chain-stitched hem, rivets at the stress points;
- selvedge = a woven edge on the outseam (cuffed shows it);
- carpenter: hammer loop + side utility pocket;
- double-knee: a second layer over the knees (stiffer);
- cargo: bellows pockets on the thighs (3D patches, heavier);
- painter: loops and pockets.

**In the sim:**
- Waistband tight (shrink group) or pinned to the pelvis.
- Sew the crotch last at low force.
- Pockets are separate small panels sewn on (or texture plus normal relief).
- Belt loops and rivets are texture detail.

### 1.9 Skirts

| skirt | maths / build |
|---|---|
| **circle family** | radius from the waist W: full R = W/2π; ¾ R = 4W/(3·2π); half R = 2W/2π; quarter R = 4W/2π (minus seam allowance) |
| straight / pencil / column / tube | hip + 4–5 cm ease, tapering to the hem (pencil); a back slit/vent for walking; GarmentCode PencilSkirt (flare 0.6–1.5, slits) |
| A-line | flare 1.2–1.5× at the hem |
| gored / panel | n panels (4–15) each W/n at the waist, hip/n at the hip, flared to the hem; trumpet = gores flared from the knee; GarmentCode SkirtManyPanels (n_panels, panel_curve) |
| godet / mermaid / fishtail | triangular inserts (godets) in the lower seams; GarmentCode GodetSkirt (insert width 10–50, depth 10–50, 4–12 inserts) |
| gathered / dirndl / peasant | a rectangle 1.5–2.5× the waist, gathered |
| tiered / rara / prairie | 2–5 tiers, each 1.5–2× the length of the one above; GarmentCode SkirtLevels (num_levels 1–5, level_ruffle 1–1.7) |
| pleated | knife 2× (3× if pleats touch), box 3×, inverted 3×, accordion/plissé (many narrow pressed zigzags); tennis/kilt/cheerleader = pleated; pleats in the sim need a fold target (XPBD dihedral) or are modelled pre-folded with a Bending group |
| wrap / sarong skirt | an overlapping panel, tie |
| slip / bias-cut | a bias grain (diagonal): clings and drapes; shear very low |
| tulip | overlapping curved front panels; bubble/puffball: hem gathered into a shorter lining; peplum skirt; trumpet; asymmetric/high-low/handkerchief = the hem shape |
| broomstick | crinkle-pleated gathered (texture + many folds) |
| tutu / tulle / petticoat / hoop / bustle | stiff layered net: many layers of LIGHT, stiff (high bending) cloth, or a hoop as a hidden collider |
| ball skirt | full circle + petticoat volume |
| kilt | wrap with knife pleats at the back, flat aprons at the front, straps/buckles; heavy wool (tartan TEX) |

### 1.10 Knit trims, bands and structure

**Rib bands (cut length / opening):**
- neckband 70–80 % (stretchy rib) / 85–88 % (firm jersey);
- cuffs and waistbands 70–85 %;
- button bands 1×1 rib (firm).

**Cut-and-sew knits** (pieces cut from knit fabric) vs **fully fashioned** (each panel knitted to shape and linked):
in 3D both are the same pattern. Fully fashioned shows "fashioning marks" (texture) and rib welts.

**Linings:** jackets and coats have a lining (a second, lighter garment inside). For the visual sim we usually skip
the lining and give the shell more bending/weight. A visible lining (an open coat) is a second layer.

**Interfacing / canvas:** a stiffer Bending group: collars, cuffs, plackets, waistbands, jacket fronts (canvas from the
shoulder through the chest into the lapel), shoulder pads (a raised padded shoulder = a hidden collider block, 1–2 cm).

**Boning** (corsets, strapless): stiff vertical strips along the seams. Use a very high bending group in narrow
vertical bands, or XPBD "wire" constraints (Seamer). Plus 5–10 % negative ease.

**Quilting / puffers:**
- sewn-through = shell and lining stitched together in channels 4–15 cm apart (puffers: 4–6 cm horizontal
  channels);
- box baffle = a third fabric wall between them (puffier, no cold seams).

**In Blender:**
- (a) Shell + lining as one closed volume per channel, with **Pressure** on (cloth Pressure, a uniform pressure force
  of a few units; seams-to-sewing-pattern uses 10 medium / 50 high for plush) and the quilting lines as sewing springs
  between the shell and the lining.
- (b) Cheaper: a single layer + a displacement/normal map per channel, with the silhouette inflated by an offset.
- CLO does the same thing: pressure against the back of the fabric inside a closed shell + lining.

**Mesh / crochet / lace / eyelet / sheer / cut-outs:** the same pattern; the holes are the texture's ALPHA (alpha-test
like our old layer.js). Sheer: alpha 0.3–0.6 + double-sided.

### 1.11 Draped and flat-cut (untailored) garments

These are mostly rectangles. The body and gravity do the shaping, so in the sim they need low bending, pins or
tucks, and self-collision.

| garment | construction |
|---|---|
| **kimono** | rectangles only, from one bolt (tan) about 36–38 cm wide × about 12 m: migoro (body, 2 lengths over the shoulders), okumi (front overlap panels, half width), eri (collar band, half width), sode (sleeves = full width × about 49 cm deep, hanging pocket-like), closed with an obi. Haori/happi/jinbei/samue/noragi = shorter kimono-cut jackets; yukata = cotton kimono |
| **hanbok** | jeogori: gil (body front/back), git (collar band) + dongjeong (white removable collar), curved baerae sleeves, goreum (long ties in a bow); chima: a wide gathered wrap skirt on a high band (under the bust) |
| **saree** | 5.5–6 m × about 1.1 m, no sewing. Nivi drape: tuck one end at the right hip into the petticoat waist, one full wrap, 5–7 pleats (opening left) tucked at the CF, the rest around the back and over the LEFT shoulder as the pallu (pleated 6–7 or open), pinned. In the sim: pin the tuck line to the petticoat's waist, and the pallu at the shoulder |
| **wrapper / iro / lappa / pagne / kanga / kikoi / sarong / lungi / mundu / veshti / longyi / sulu / lava-lava / malong / sinh / sampot / tapis** | a rectangle (about 1–2 m × 1.1–1.2 m) wrapped around the waist and tucked/knotted (iro: knotted or tucked at the front; double wrapper = two layers). In the sim: wrap with overlap, pin the tuck band, gravity |
| **dhoti / veshti pants / dhoti pants** | a rectangle wrapped and passed between the legs (a drape-pinned crotch); dhoti pants = a sewn version with a dropped crotch |
| **agbada** (Yoruba) | three parts: a large rectangular body panel + very wide sleeve panels; overall width about wrist-to-wrist with the arms out, length shoulder → knee/ankle; neck hole (orun) and a big left pocket (apo); heavy embroidery at the front/back neck; worn over a **buba** (a loose tunic top) and **sokoto** (drawstring trousers). Fabric 4–7 yards. Its sleeves are folded up onto the shoulders when worn. In the sim: huge, light-to-medium fabric, low bending, the folded sleeve drape pinned at the shoulders |
| **grand boubou / babariga** | the same family as agbada (a wide over-robe) |
| **dashiki / danshiki** | a T-shaped pullover tunic (kimono-cut sleeves), V or round neck with an embroidered yoke (TEX) |
| **senator / kaftan top** | a straight tunic (set-in sleeves), mandarin/round neck, side slits, usually with matching trousers |
| **isiagu** | a pullover tunic, lion-head print (TEX) |
| **fugu / batakari / smock** | woven strip cloth sewn into a wide, flared tunic, often gathered, with side gores (a flared trapeze body) |
| **kaftan / jalabiya / gandoura** | a T-shaped or A-line long robe, kimono-cut or set-in sleeves, often a slit neck |
| **djellaba** | a long, loose hooded robe, T-cut, wide sleeves, front slit; **abaya**: a straight/flowing over-robe from the shoulder to the floor (open or closed, bat or straight sleeves) |
| **thobe / dishdasha / kandura** | an ankle-length shirt-dress: 4-panel cut (Saudi) with a shirt collar or band, a placket with 3–5 buttons, cuffs (or open); kandura = collarless with a tassel (farukha) and placket embroidery |
| **bisht** | a sheer/light cloak, open front, gold trim, wide sleeve openings (a cape-like rectangle body) |
| **kurta** | a straight body + set-in or kimono sleeves, a band collar or round neck with a placket; kalidar kurta = 4 triangular kalis (side gores, narrow end about 3 in, wide at the hem) + underarm gussets; chak = side slits. Kurti = short kurta. Pathani = longer, a collar and a placket. Sherwani/achkan = a fitted long coat, mandarin collar, front buttons. Angrakha = an overlapping wrap bodice tied at the side |
| **salwar / Patiala / churidar** | salwar = very wide pleated/gathered pants narrowing to the ankle (Patiala = more pleats); churidar = very long, tight legs bunching at the ankle (cut long, bias) |
| **kameez** | a long tunic (kurta family) |
| **lehenga / ghagra** | a flared (paneled/circle) long skirt on a drawstring, with a choli (a fitted short blouse) and dupatta (a scarf draped, as with the pallu) |
| **sharara / gharara** | flared trousers (gharara = flared from the knee with a seam) |
| **barong Tagalog** | a sheer embroidered shirt-tunic, untucked, collar band (sheer: alpha) |
| **baju Melayu / baju koko / baju kurung** | a loose tunic + a mandarin/round collar; baju kurung adds a long skirt (kain); baju Melayu adds a sampin (a short sarong over the trousers) |
| **ao dai** | a fitted long tunic, mandarin collar, side slits to the waist, over wide trousers |
| **changshan / tang jacket / qipao-style** | a mandarin collar, frog closures, a curved diagonal front opening (qipao), kimono or set-in sleeves |
| **hanfu top** | a crossover collar (right over left), wide sleeves, sash |
| **gho / kira** | a knee-length wrapped robe, belted, folded cuffs |
| **vyshyvanka / kosovorotka** | an embroidered tunic shirt; kosovorotka = an off-centre placket |
| **ghillie shirt** | laced V neck, full sleeves; **Prince Charlie jacket** = a short formal jacket with tails (kilt) |
| **dirndl** | a fitted bodice + full gathered skirt + apron + short puff-sleeved blouse |
| **Tracht shirt / lederhosen** | the shirt + leather shorts with braces (stiff leather) |
| **serape / ruana / poncho** | a rectangle with a head slit (poncho), or open at the front (ruana); heavy wool |
| **huipil** | rectangular woven panels sewn into a loose tunic (a head opening); **quechquemitl** = two rectangles forming a pointed cape |
| **pollera** | a voluminous tiered skirt |
| **chima / mamianqun (horse-face skirt)** | mamianqun = two overlapping pleated panels with flat "faces" front and back |
| **hakama** | wide pleated trousers or a divided skirt, back board (koshi-ita), ties |
| **pa'u** | a gathered wrap skirt |
| **kebaya** | a fitted sheer blouse-jacket (alpha) over a sarong |
| **terno** | butterfly sleeves (stiffened, standing puff caps) |
| **baro't saya** | a blouse + skirt |
| **cape / cloak / Inverness / poncho** | a circle (cape: half or full circle, neck radius ≈ neck/6 for a full circle, ×2 for a half), optional hood and shoulder darts; Inverness = a coat with a cape over the shoulders |

### 1.12 Swim, lingerie, active

**Negative ease:**
- leggings −5…−10 %;
- swim −8…−12 % horizontally;
- 4-way spandex −10…−15 %;
- compression more still.

**In the sim:** shrink 0.08–0.15 everywhere + low collision distance (2–3 mm). It is basically a shrink-wrap that keeps
its seams. Shrinkwrap-modifier tight parts can replace the sim.

**Pieces:**
- bikini triangle (a triangle cup, elastic edges, string ties); bandeau (a tube band); halter (a neck tie); underwire
  (a seamed cup + wire = a stiff curve, a high-bending strip under the cup);
- tankini; one-piece (swimsuit body with leg openings high/low);
- bottoms (brief/hipster/cheeky/Brazilian/thong/tie-side/boyshort/high-waist), defined by the leg-line height and the
  back coverage;
- trunks / board shorts / jammers / square-cut;
- sports bra (a compression crop, racerback); leotard / unitard / catsuit / bodysuit (a snap crotch);
- wetsuit (neoprene: thick 3–5 mm, high bending, SOLIDIFY thick);
- rash guard (a raglan compression top).

**Bra cups:** two or three panels (lower/outer + inner) meeting at the apex; drop the upper cup seam's centre 5 mm (more
= pointier).

### 1.13 One-pieces

- **Jumpsuit / boiler suit / coverall / flight suit:** bodice + trousers joined at the waist (or one piece); add 2–4 cm
  torso-length ease (sitting/bending); front zip or buttons.
- **Overalls / dungarees:** a pant + bib (shaped from the bodice block) + adjustable straps (no extra torso ease
  needed); shortalls; skirtall.
- **Romper / playsuit:** a shorts jumpsuit.

**In the sim:** pin the shoulder straps; sew the crotch last.

---

## Part 2: fabrics → simulation settings

Starting values for Blender's cloth modifier (4.2: mass kg/m² per vertex scale, stiffnesses, bending; Angular bending
model). They are blended from Blender's presets, opensew's fabrics and Seamer's presets (KNOWLEDGE §2, §10.4).
CALIBRATE each on a test drape: hang a 50 × 50 cm square from two corners and compare its fold count and drop with a
photo of the real fabric.

| fabric | mass | tension | compression | shear | bending | thickness (solidify) | notes |
|---|---|---|---|---|---|---|---|
| jersey (tee) 150–200 g/m² | 0.25–0.30 | 15 | 12–15 | 5 | 0.5–1 | 1.0–1.5 mm | knits: low compression, low shear |
| rib knit (bands, A-shirt) | 0.30 | 10 | 8 | 4 | 1 | 1.5 mm | stretchy: sew bands shorter |
| pique (polo) | 0.32 | 18 | 18 | 6 | 2 | 1.5 mm | |
| French terry / sweatshirt fleece 280–350 g/m² | 0.40 | 18 | 20 | 8 | 4 | 2–3 mm | |
| polar fleece / sherpa | 0.40–0.50 | 15 | 20 | 6 | 6 | 3–6 mm | sherpa = fur texture/normal |
| waffle / thermal | 0.30 | 14 | 14 | 5 | 1.5 | 2 mm | waffle = normal map |
| spandex / lycra | 0.20 | 8 (high stretch) | 8 | 3 | 0.2 | 0.7 mm | negative ease, shrink 0.08–0.15 |
| neoprene | 0.80 | 30 | 40 | 15 | 40 | 3–5 mm | |
| poplin / broadcloth (shirts) | 0.15–0.20 | 20 | 60–120 | 8 | 10–25 | 0.4 mm | crisp: few, larger folds |
| Oxford (shirts) | 0.20 | 22 | 120 | 10 | 25 | 0.5 mm | |
| twill / chino / drill | 0.30 | 25 | 120 | 12 | 30 | 0.6 mm | |
| denim light (shirt) 200–280 | 0.35 | 30 | 150 | 15 | 35 | 0.7 mm | |
| denim heavy (jeans) 340–450 | 0.6–1.0 | 40 | 200 | 40 | 40–60 | 0.9–1.2 mm | Blender Denim preset: mass 1, 40/40/40, bend 10 (softer) |
| linen | 0.18 | 25 | 80 | 10 | 15 | 0.4 mm | wrinkles: compression lower than poplin |
| flannel (shirt) | 0.28 | 20 | 60 | 8 | 12 | 1 mm | |
| corduroy | 0.40 | 25 | 120 | 12 | 35 | 1.2 mm | wales = normal map |
| seersucker | 0.15 | 18 | 40 | 6 | 8 | 0.5 mm | puckers = normal map |
| chambray | 0.18 | 20 | 80 | 8 | 15 | 0.4 mm | |
| silk / satin / charmeuse | 0.10–0.15 | 5–12 | 5–8 | 3 | 0.05–0.15 | 0.2 mm | Blender Silk preset; fluid |
| chiffon / organza / voile / sheer | 0.05–0.08 | 6 | 5 | 2 | 0.05 (chiffon) / 2 (organza: crisp) | 0.1 mm | alpha 0.3–0.6 |
| crepe / rayon challis | 0.14 | 8 | 8 | 3 | 0.2 | 0.3 mm | drapes |
| velvet / velour | 0.30 | 15 | 20 | 6 | 3 | 1.5 mm | sheen shader |
| wool suiting (fine) | 0.25 | 25 | 120 | 12 | 25 | 0.6 mm | + canvas Bending group at the fronts |
| tweed / flannel wool | 0.40 | 28 | 140 | 14 | 35 | 1.2 mm | |
| melton / coat wool / loden | 0.60–0.80 | 35 | 200 | 20 | 60 | 2–3 mm | |
| leather | 0.40–0.60 | 80 | 80 | 80 | 150 | 1–1.2 mm | Blender Leather preset |
| suede | 0.40 | 60 | 60 | 50 | 100 | 1.2 mm | |
| waxed cotton | 0.40 | 35 | 180 | 20 | 50 | 0.8 mm | |
| nylon shell (windbreaker, bomber, rain) | 0.12 | 30 | 80 | 10 | 5 | 0.2 mm | crinkly: compression moderate |
| down / puffer channel | 0.15 shell | 25 | 40 | 8 | 4 | volume via pressure | see §1.10 |
| chunky knit / cable / Aran | 0.60 | 12 | 20 | 6 | 8 | 4–8 mm | cables = normal + displacement |
| fine merino / cashmere | 0.20 | 10 | 10 | 4 | 0.8 | 1 mm | |
| mohair / angora / bouclé | 0.25 | 10 | 12 | 4 | 1.5 | 2–3 mm | fuzz = shell texture / fins |
| crochet / mesh / lace / eyelet | as the base yarn | | | | | | holes = alpha |
| sequin / beaded | +30 % mass | | | +bend | | | sparkle = shader (metallic flakes) |
| tulle / net (tutu) | 0.03 | 10 | 10 | 3 | 5–20 | 0.1 mm | stiff, light, many layers |
| canvas / duck | 0.70 | 40 | 220 | 25 | 70 | 1 mm | |
| chainmail | heavy, rigid links | | | | | | texture + high mass, low bending |

**Grain:** wovens are stiff along the grain and very soft on the bias. A bias-cut skirt or cowl needs the pattern
ROTATED 45° on the grid so the mesh's rows run on the bias (opensew's grid follows the grain). Knits stretch more
crosswise: in XPBD set warp/weft compliance separately (Seamer).

---

## Part 3: the catalogue

Notation:
- **B** body/fit · **S** shoulder+sleeve · **N** neck/collar · **C** closure · **L** length · **H** hem · **F** fabric
  · **+** extras.
- `= X` same build as X; `TEX` = the same garment with a different texture only.

### MEN'S TOPS

**T-shirts** (base = Plain crew neck tee):

| garment | build |
|---|---|
| Plain crew neck tee | B regular knit (+6…10 cm), straight side seams · S set-in, shallow cap, short 20–21 cm (M), hem 0.88 × the cap width · N crew 6 / 2.2 cm, rib band 2.5 cm folded at 85 % · L hip (70–74 cm HPS, M) · H turned 2.5 cm · F jersey 180 g |
| V-neck tee | = crew, N V 12–15 cm front, mitred band |
| Scoop neck tee | = crew, N scoop 10–12 cm |
| Pocket tee | = crew + a chest patch pocket (left, about 11 × 13 cm), a small sewn panel or texture + relief |
| Graphic tee, tie-dye, striped (Breton) tee | TEX (Breton: boat neck, ¾ or long sleeve, navy stripes) |
| Long-sleeve tee | = crew, S long (+8 % cut), H turned or a rib cuff |
| Ringer tee | = crew + contrast rib neck and sleeve bands (TEX + bands) |
| Raglan (baseball) tee | B regular · S raglan, ¾ sleeve in contrast colour |
| Oversized tee | B +25…40 cm · S drop shoulder 6–10 cm, sleeve to the elbow · L +5 cm |
| Boxy tee | B wide (hem = chest) · S drop shoulder · L short (high hip) |
| Drop-shoulder tee | = regular with a drop shoulder 4–6 cm |
| Longline tee | L hip + 8–12 cm, often a curved hem |
| Cropped tee | L waist − 0…5 cm |
| Muscle tee | B fitted · S sleeveless with a deep, wide armhole (no sleeve, cut at the shoulder) |
| Mock neck tee | N mock 3–5 cm |
| Slub tee | TEX (slub = irregular yarn texture) |
| Waffle / thermal tee | F waffle (normal), long sleeve, rib cuffs |
| Mesh tee | F mesh (alpha) |
| Split-hem tee | H side vents 5–8 cm |
| Curved-hem tee | H shirttail curve |

**Sleeveless:**

| garment | build |
|---|---|
| Tank top | B regular · S sleeveless, standard straps 4–6 cm · N scoop · bound edges |
| Singlet | = tank (athletic, light) |
| A-shirt (ribbed vest) | F rib knit, a deep scoop neck and armholes, narrow straps 2–3 cm, B fitted |
| Stringer | very deep armholes to the waist, 1–2 cm straps, racerback |
| Sleeveless tee | = crew without sleeves (armhole bound) |
| Cut-off tee | = crew with the sleeves cut off raw (a ragged armhole: TEX alpha edge) |
| Racerback tank | the straps meet in a Y at the upper back |
| Basketball-style tank | a wide armhole, mesh (alpha), a V or round neck rib, long |
| Sleeveless hoodie | = hoodie with the sleeves removed, a deep armhole |

**Polos and collared knits:**

| garment | build |
|---|---|
| Short-sleeve polo | B regular · S set-in short with rib arm bands · N flat-knit polo collar on a 2–3-button placket (12–15 cm) · H split hem with a longer back (tennis tail) · F pique |
| Long-sleeve polo | S long, rib cuffs |
| Knit polo | F fine knit (merino) |
| Zip polo | C a short zip placket |
| Johnny collar polo | N polo collar on an open V, no buttons |
| Pique polo, performance / golf polo | TEX / F (pique / poly) |
| Rugby shirt | B regular-relaxed · S long, set-in · N woven twill collar (white) on a 2–3-button rubber-button placket · F heavy jersey 300+ g, stripes TEX |
| Henley (short / long) | = tee + N crew band with an 8–13 cm placket, 2–5 buttons |
| Knitted button-through shirt | = cardigan-like shirt: knit body, shirt or camp collar, full placket |

**Button shirts** (base = Button-up shirt):

| garment | build |
|---|---|
| Button-up shirt | B woven regular (+15…20 cm), back yoke (8–10 cm CB) + optional box pleat or side pleats below the yoke · S set-in, medium cap, long with a sleeve placket + barrel cuff (6 cm, 1–2 buttons) · N collar + stand (stand 3, fall 4.5) · C full placket 3.5 cm, 7–8 buttons 8–9 cm apart · L hip, shirttail curved H · F poplin/oxford |
| Dress shirt | = button-up, slim/regular, spread/point collar, interfaced collar and cuffs, F fine poplin/twill |
| Button-down (Oxford) shirt | N collar points buttoned to the body · F Oxford |
| Poplin, twill, linen, flannel, denim, chambray, corduroy, seersucker shirt | F per Part 2 (denim and western often have flap pockets) |
| Silk / satin shirt | F silk (fluid), often a camp collar |
| Sheer shirt | F sheer (alpha) |
| Crochet shirt | F crochet (alpha), often a camp collar, boxy |
| Western (snap) shirt | pointed front and back yokes, snaps (pearl), snap flap chest pockets, 3-snap cuffs |
| Lumberjack / plaid, gingham, striped, Madras shirt | TEX (+ flannel F for lumberjack) |
| Short-sleeve button shirt | S short (22–25 cm), no cuff, turned hem |
| Camp / Cuban collar shirt | N camp collar (no stand, open revere) · B boxy · H straight with side vents · S short |
| Hawaiian (aloha) shirt | = camp collar shirt, rayon F, print TEX |
| Bowling shirt | = camp collar, two-tone panels (TEX), straight hem, boxy |
| Band / mandarin / grandad collar shirt | N band only (no fall) |
| Popover shirt | C a half placket (pullover) |
| Tunic shirt | L mid-thigh, band collar, side slits |
| Tuxedo shirt (pleated or bib front) | = dress shirt + a pleated or piqué bib panel on the front (TEX relief / a separate stiff panel), wing or turndown collar, French cuffs, studs |
| Wing collar shirt | N wing collar |
| French cuff shirt | cuff double length folded back + cufflinks |
| Spread, cutaway, club, tab, pin collar shirt | N fall tip variants |
| Safari shirt | 4 bellows pockets, epaulettes, belt optional, camp or point collar, F cotton drill |
| Military shirt | 2 flap chest pockets with box pleats, epaulettes, roll-up sleeve tabs |
| Utility / work shirt | 2 flap pockets, heavier twill, pen slot |
| Fishing shirt | vented back yoke (mesh), many pockets, roll-up tabs, nylon |
| Guayabera | 4 patch pockets, two vertical pleat rows (alforzas) front and back, straight hem with side vents, camp collar, linen |
| Poet / pirate shirt | B very full, gathered at the yoke, S bishop with ruffled cuffs, N jabot or lace-up V, F light linen/silk |
| Zip-front shirt | C zip instead of buttons |
| Half-zip shirt | C half zip |
| Overshirt | = heavy shirt worn open over a tee (relaxed, flannel/twill/wool, 2 flap pockets) |
| Shacket | = overshirt, heavier (wool/quilted), jacket-like length |

**Sweaters and knitwear** (base = Crew neck sweater):

| garment | build |
|---|---|
| Crew neck sweater | B regular knit +10…15 cm · S set-in or saddle, long with rib cuffs 6–8 cm · N rib crew band · H rib welt 6–8 cm at 85–90 % (blouses slightly) · F knit (fine → chunky) |
| V-neck sweater | N V with a mitred rib |
| Turtleneck (roll neck) | N a tall rib tube 15–25 cm folded double |
| Mock neck sweater | N mock |
| Boat neck sweater | N boat |
| Shawl collar sweater | N shawl collar overlapping at a V (knit) |
| Polo sweater | N knit polo collar + placket |
| Henley sweater | N crew + button placket |
| Quarter-zip / half-zip sweater | N stand collar + zip |
| Full-zip sweater | C full zip, stand collar |
| Hooded sweater | N knit hood |
| Button cardigan | C rib button band (1×1, firm) 3 cm, V neck · B regular |
| Zip cardigan | C zip |
| Shawl collar cardigan | N shawl collar, often chunky |
| Longline cardigan | L mid-thigh to knee |
| Sweater vest | S sleeveless with rib armbands, V neck |
| Cable knit, Fisherman (Aran), Fair Isle, Nordic, Shetland, Argyle, ribbed, waffle knit | TEX + normal/displacement (Aran: chunky cables, saddle shoulders; Fair Isle/Nordic: colourwork yoke TEX) |
| Guernsey | boxy, saddle shoulder, side vents, knit-purl yoke pattern (TEX), F dense wool |
| Cowichan | chunky wool, shawl collar, zip, motifs (TEX) |
| Cricket / tennis sweater | V neck, cable knit, stripe trim at the V and hem (TEX) |
| Commando sweater | heavy rib knit, shoulder and elbow patches (a separate twill panel or TEX + relief), epaulettes |
| Chunky knit | F chunky (thickness 4–8 mm) |
| Fine-gauge merino, cashmere, mohair sweater | F per Part 2 |
| Knitted tee | = tee in fine knit |

**Sweatshirts, hoodies, fleece:**

| garment | build |
|---|---|
| Crewneck sweatshirt | B relaxed +15…20 cm · S set-in or raglan, long with rib cuffs · N rib crew (+ a V-insert detail TEX) · H rib band 85–90 % · F French terry/fleece 300–350 g |
| Pullover hoodie | = sweatshirt + N hood 2- or 3-panel, drawcord + kangaroo pocket (top 11 cm, bottom 20, sides 8, angled openings 15 cm) |
| Zip-up hoodie | C full zip, the pocket split in two |
| Quarter-zip / half-zip sweatshirt | N stand collar + zip |
| Funnel neck sweatshirt | N funnel (a tall stand in one with the body) |
| Raglan sweatshirt | S raglan |
| Oversized sweatshirt | B +30 cm, drop shoulder |
| Cropped sweatshirt | L waist |
| Short-sleeve hoodie | S short |
| Fleece pullover | F polar fleece, ¼ zip, stand collar |
| Snap-neck fleece | a snap placket + flap pocket (Snap-T) |
| Fleece jacket | full zip, F fleece |
| Sherpa pullover | F sherpa (fur), contrast trims |
| Tech fleece | a slim zip hoodie, bonded panels (TEX seams) |
| Track top | zip, stand collar, raglan or set-in, side stripes (TEX), rib cuffs and hem, F tricot |

**Jackets** (base = a lined jacket; usually skip the lining in the sim, stiffen the shell):

| garment | build |
|---|---|
| Bomber jacket | B relaxed, blousy · S set-in or raglan, rib cuffs · N rib collar · H rib waistband 85 % · C zip · F nylon + quilt lining (MA-1: a sleeve pocket) |
| Denim (trucker) jacket | B regular-short (waist) · S set-in, 2-piece, button cuffs · N shirt collar · C buttons · front + back pleats/seams, 2 flap chest pockets, waistband with side tabs · F heavy denim |
| Leather biker jacket | asymmetric zip, wide notched lapels with snaps, belt, zip cuffs, epaulettes · F leather · L waist |
| Cafe racer jacket | a stand collar with a snap tab, centre zip, minimal · F leather |
| Flight / aviator jacket | shearling (fur collar + lining), waist band · F leather |
| Shearling jacket | F suede + sherpa edges |
| Suede jacket | F suede (trucker or shirt cut) |
| Harrington jacket | N stand/funnel collar with a throat-button tab · C zip · S raglan, rib cuffs · H rib band · back storm yoke (umbrella yoke) · F cotton poplin, tartan lining |
| Varsity (letterman) jacket | wool body + leather raglan sleeves · rib collar, cuffs and hem · snaps · chenille letters (TEX) |
| Coach jacket | snap front, turndown collar, drawcord hem · F nylon |
| Track jacket | = track top |
| Windbreaker | nylon, zip, hood, elastic cuffs, drawcord hem |
| Anorak / cagoule | pullover with a half zip + kangaroo pocket + hood, drawcords · F nylon |
| Rain jacket / shell jacket | hood, storm flap over the zip, taped seams (TEX), velcro cuffs · F coated nylon |
| Softshell | stretch-woven, slim, zip, stand collar |
| Field jacket (M-65) | 4 flap pockets, stand collar with a hidden hood, zip + storm flap with snaps, drawcord waist · F cotton-nylon sateen |
| Chore coat | boxy, 3 patch pockets, shirt collar, buttons · F canvas/twill/moleskin |
| Utility jacket | = field/chore family |
| Safari jacket | = safari shirt, heavier + belt |
| Hunting jacket | waxed or tweed, game pocket, corduroy collar |
| Waxed jacket | F waxed cotton, corduroy collar, bellows pockets (Barbour) |
| Quilted jacket | diamond quilting (sewn-through, normal map or pressure), corduroy collar, snaps |
| Puffer / down jacket | horizontal channels 4–6 cm, pressure, stand collar or hood, elastic/velcro cuffs · F nylon |
| Ski jacket | insulated shell, powder skirt, hood, many zips |
| Blouson | blousy body gathered into a waistband |
| Souvenir (sukajan) jacket | = bomber in satin + embroidery TEX, reversible |
| Corduroy jacket | trucker or sport-coat cut, F corduroy |
| Eisenhower jacket | cropped at the waist, a waistband with a buckle, pleated pockets, shirt collar/lapels |
| Cropped jacket | L waist |
| Hooded jacket | + hood |
| Motorcycle racing jacket | leather/textile, armour (padded panels = thicker), stand collar, colour blocks |

**Vests and gilets:**

| garment | build |
|---|---|
| Suit waistcoat | fitted, V neck, 5–6 buttons, welt pockets, back panel in lining fabric with a cinch strap, pointed front hem · F suiting |
| Puffer vest / down gilet | = puffer jacket, sleeveless |
| Fleece vest, quilted vest, denim vest, leather vest | the respective jacket without sleeves |
| Utility / cargo vest, fishing vest | many bellows pockets, mesh back |
| Knitted vest | = sweater vest |
| Tactical vest | plate carrier: thick padded panels (rigid), webbing (TEX), straps |
| Hi-vis vest | mesh, reflective stripes (emissive TEX), velcro front |

**Coats:**

| garment | build |
|---|---|
| Overcoat / topcoat | B +20…30 cm over a jacket · S set-in 2-piece · N notched lapel · C single-breasted 3–4 buttons · L knee (topcoat: above the knee, lighter) · back vent · F melton/wool |
| Trench coat | double-breasted (10 buttons), gun flap (right chest), storm flap (back yoke), epaulettes, raglan sleeves with cuff straps, self belt with D-rings, back vent · L knee · F gabardine (waxed/twill) |
| Pea coat | double-breasted, broad lapels, vertical slash hand-warmer pockets · L hip · F melton |
| Duffle coat | toggles + rope loops, hood, patch pockets, back yoke · F heavy wool |
| Chesterfield | single-breasted, velvet collar, fly front (hidden buttons) |
| Car coat | short (mid-thigh), straight, simple |
| Mac / mackintosh / raincoat | raglan, single-breasted fly front, rubberised · F coated cotton |
| Parka | hood with fur trim, zip + storm flap, drawcord waist, 4 pockets · L thigh · insulated |
| Puffer coat | = puffer jacket, long |
| Shearling coat | suede + fur |
| Ulster | double-breasted, a cape or half-belt, Ulster collar (wide) |
| Polo coat | double-breasted, camel hair, patch pockets, half belt, turnback cuffs |
| Covert coat | short, fly front, 4 rows of stitching at the cuffs and hem (TEX), velvet collar |
| Greatcoat | heavy military, double-breasted, very long, cape optional |
| Balmacaan | raglan sleeves, a small Prussian collar, fly front |
| Loden coat | F green felted wool, an inverted pleat at the back (box pleat to the yoke), raglan |
| Duster | ankle-length light coat, a back slit to the waist (riding) |
| Inverness cape | a sleeveless coat with an attached shoulder cape |
| Cape / cloak | half or full circle (§1.11) |
| Poncho | a rectangle with a head slit, or a circle |

**Tailored and formal** (base = Suit jacket):

| garment | build |
|---|---|
| Suit jacket | B fitted +10…14 cm, front darts + side panel (3-panel body) · S 2-piece set-in, shoulder pad + sleeve head · N notched lapel (8–9 cm wide), roll line to the break at the top button · C single-breasted, 2 buttons · canvas front · welt chest pocket, 2 flap pockets · back: single or double vents · L covers the seat · F wool suiting |
| Blazer | = suit jacket, often patch pockets, metal buttons, navy |
| Sport coat | = suit jacket in tweed/check (TEX), patch pockets |
| Unstructured blazer | no canvas/pads (soft shoulder, lower bending) |
| Double-breasted jacket | 6×2 buttons, peak lapels, wide overlap |
| Tuxedo (dinner) jacket | satin peak or shawl lapels (sheen TEX on the lapels), 1 button, jetted pockets |
| Smoking jacket | velvet, shawl collar, toggles/frogs, belt |
| Tailcoat | cut short at the front (waist), tails at the back to the knee, double-breasted (open) |
| Morning coat | single button, curved front cutaway sloping to tails |
| Frock coat | knee-length, fitted waist seam, full skirt |
| Mess jacket | short waist-length formal jacket, no tails |
| Norfolk jacket | box pleats front and back, a belt, a yoke |
| Nehru jacket | a mandarin collar, single-breasted, hip length |
| Mao jacket | turndown collar (Zhongshan), 4 flap pockets, 5 buttons |
| Bandhgala | = Nehru, tighter, a high band collar, formal |

**Sports and activewear:**

| garment | build |
|---|---|
| Football (soccer) jersey | B regular · S raglan or set-in · N crew/V/polo collar · F poly mesh (micro-holes TEX) |
| Goalkeeper shirt | long sleeves, padded elbows |
| Basketball jersey | = basketball tank |
| Baseball jersey | button front, piping (TEX), set-in short |
| American football jersey | cropped shoulder area, over pads (a bulky hidden collider at the shoulders) |
| Hockey jersey | huge, raglan, lace-up neck, over pads |
| Rugby jersey | = rugby shirt, tight modern (stretch) |
| Cricket shirt | white polo-like, long sleeves |
| Cycling jersey | race cut (compression), long front zip, rear pockets, silicone gripper hem |
| Racing jersey | = cycling/motocross |
| Running singlet | light tank, mesh |
| Training tee | = tee, poly |
| Compression shirt / base layer | negative ease (−10 %), raglan, F spandex |
| Rash guard | = compression raglan |
| Wetsuit top | F neoprene 3–5 mm, back zip |
| Warm-up top | = track top |
| Training bib | a mesh pinny over the shoulders (rectangle with a neck hole and side ties) |

**Traditional and cultural (men):** agbada, buba, dashiki, kaftan, senator, babariga, grand boubou, isiagu, fugu/batakari,
Madiba shirt (= a loose, untucked silk camp-collar shirt), jalabiya, djellaba, thobe, bisht, kurta, pathani,
sherwani, achkan, angrakha, barong Tagalog, baju Melayu, baju koko, kimono, haori, happi, jinbei, samue, noragi, tang
jacket, changshan, hanfu top, ao dai, gho, vyshyvanka, kosovorotka, ghillie shirt, Prince Charlie jacket, Tracht
shirt, serape, ruana: see §1.11.

**Underwear, sleep, lounge:**

| garment | build |
|---|---|
| Undershirt | = fitted crew or V tee or A-shirt, light jersey |
| Thermal top | waffle, long sleeves, rib cuffs, fitted |
| Pajama shirt | camp collar or notched-lapel PJ shirt, piping (TEX), loose, F cotton/flannel/satin |
| Lounge tee | = tee |
| Robe / dressing gown / bathrobe | shawl collar wrap, belt, kimono or set-in sleeves, L knee to ankle, F terry (thick) or satin |

**Work and uniform:**

| garment | build |
|---|---|
| Scrubs top | V neck, boxy, set-in short, chest pocket, F poly-cotton |
| Chef jacket | double-breasted with cloth knots or studs, a stand collar, long sleeves, F heavy white twill |
| Lab coat | a knee-length coat, notched collar, 3 patch pockets, buttons |
| Mechanic / work shirt | = work shirt |
| Combat shirt | torso in wicking knit, sleeves ripstop with pockets, a mandarin zip neck |
| Military tunic | fitted, a stand or lapel collar, 4 pockets, belt, epaulettes |
| Clerical shirt | a band collar with a white tab insert |
| Cassock | ankle-length fitted robe, standing collar, many small buttons |
| Security / pilot uniform shirt | dress shirt + epaulettes + 2 flap pockets |

**Fashion and statement:**

| garment | build |
|---|---|
| Crop top | L above the waist |
| Mesh top | F mesh (alpha) |
| Sheer top | alpha |
| Bodysuit | a tee/tank + brief bottom with a snap crotch, fitted (negative ease) |
| Kimono-style cardigan | open front, kimono sleeves, light |
| Asymmetric top | an uneven hem or neckline |
| Cut-out top | alpha holes in the pattern |
| Corset-style top | boned panels, lace-up (§1.10) |
| Harness top | straps (narrow cloth strips or rigid TEX) |
| Shrug | a cropped bolero: sleeves + a band across the back |

### WOMEN'S TOPS (deltas from the men's builds; women's base block = shaped waist, bust dart/princess for wovens, knit tops fitted)

**T-shirts:**

| garment | build |
|---|---|
| Plain crew neck tee | B fitted knit (0…+5 cm) with a shaped waist, S set-in short 15 cm with a narrow cuff (0.82), N crew 7.5 / 2.2 cm, L hip |
| V-neck, scoop, boat neck, pocket, graphic, long-sleeve, ringer, raglan, oversized, boxy, cropped, longline, muscle, mock neck tee | as men's |
| Baby tee | B fitted tight, cropped, short tight sleeves |
| Fitted tee | B 0 cm ease |
| Boyfriend tee | = men's regular/oversized |
| Cap-sleeve tee | S cap |
| Dolman tee | S dolman |
| Striped (Breton), tie-dye, slub tee | TEX |
| Ribbed tee | F rib, fitted |
| Waffle tee | as men's |
| Knot-front tee | a front hem tie |
| Twist-front tee | a twisted front panel (a front drape folded through itself: model as two crossing panels) |
| Split-hem, curved-hem tee | as men's |
| V-back tee | back neckline V |

**Tanks, camis, strapless:**

| garment | build |
|---|---|
| Tank, ribbed, racerback, muscle tank | as men's |
| High-neck tank | N high round, cut-in armholes |
| Scoop tank | N scoop |
| Swing tank | A-line flare from the bust |
| Cropped tank | L waist |
| Peplum tank | + a circular peplum at the waist |
| Built-in-bra tank | + an inner shelf bra band (elastic) |
| Sleeveless turtleneck | N turtleneck, no sleeves |
| Shell top | a simple woven sleeveless top, round neck, back button/zip |
| Camisole | spaghetti straps, straight or V neck, bias, F silk/satin |
| Lace-trim cami | + lace edge (alpha) |
| Satin/silk cami | F silk |
| Spaghetti strap top | = cami |
| Halter top | N halter (ties behind the neck), open back |
| Tube top / bandeau | a strapless tube, negative ease, shirred/elastic |
| Bralette top | soft bra-like cups + band |
| Bustier top | cups + boning, strapless/straps |
| Corset top | boned panels, lace-up |
| Crop top | short |
| One-shoulder top | a single strap/sleeve |
| Off-the-shoulder (Bardot) | an elastic band across the upper arms |
| Cold-shoulder | sleeves with a shoulder cut-out |

**Blouses** (woven, base = Button-up blouse: shaped, bust darts, collar + stand or a softer collar, placket):

| garment | build |
|---|---|
| Pussy-bow / tie-neck | N a long tie strip at the neck, tied in a bow |
| Peasant / boho | a gathered neckline (elastic/drawstring), raglan or dropped puff sleeves |
| Wrap blouse | C wrap with ties |
| Surplice | the crossover sewn down |
| Peplum blouse | + peplum |
| Ruffle blouse | ruffles at the neck, front or hem (1.5–2.5× strips) |
| Smocked / shirred | elastic-gathered panels (normal map + shrink group) |
| Tiered blouse | tiers |
| Babydoll | a short bodice + full gathered body from the empire line |
| Trapeze / swing | A-line from the shoulders |
| Tunic blouse | long |
| Poet blouse | bishop sleeves, ruffles |
| Victorian (high-neck) | N high band + ruffle, pintucks, leg-of-mutton/bishop sleeves |
| Sailor (middy) | N sailor collar |
| Peter Pan collar blouse | N Peter Pan |
| Jabot | N a cascading ruffle at the CF |
| Pintuck | narrow stitched folds (normal map / relief) |
| Embroidered, eyelet (broderie anglaise), lace, chiffon, organza, satin, silk blouse | F/TEX (eyelet/lace: alpha) |
| Keyhole blouse | N keyhole |
| Milkmaid top | a sweetheart/square neck, puff sleeves, a fitted shirred bodice |
| Kaftan top | §1.11 |

**Tops by sleeve and neckline:** puff, bishop, balloon, bell, flutter, lantern, kimono, batwing, cap sleeve (§1.2) ·
square, sweetheart, cowl, plunge, halter, choker, asymmetric neck (§1.3).

**Statement and going-out:**

| garment | build |
|---|---|
| Bodysuit | as men's |
| Wrap top | C wrap |
| Ballet wrap top | a cropped wrap with long ties around the waist, knit |
| Draped top | cowl/bias drapes |
| Backless / open-back | the back cut away (low back neckline) |
| Tie-back, tie-front | ties |
| Cut-out | alpha holes |
| Lace-up | eyelets + cord |
| Handkerchief hem | H points |
| High-low | back longer |
| Sequin, beaded | F sequin |
| Mesh, sheer, chainmail | alpha / F |
| Scarf top | a square scarf tied as a halter (a rectangle pinned at the neck and back) |
| Feather, fringe | strands/cards (texture alpha strips, hair-card-like) |
| Harness top | straps |

**Button shirts:** classic button-up, button-down, boyfriend (= men's regular/oversized), oversized, cropped, poplin, linen,
denim, chambray, flannel, plaid, gingham, striped, corduroy, silk, satin, western, camp collar, Hawaiian, bowling,
band collar, popover, tunic, tuxedo shirt; plus:

| garment | build |
|---|---|
| Tie-front shirt | front hem ties |
| Wrap shirt | wrap |
| Shirt bodysuit | + a brief bottom |
| Sleeveless shirt | no sleeves |
| Short-sleeve shirt | short sleeves |
| Utility, safari shirt | as men's |
| Pajama-style shirt | piped camp/notched collar, satin |
| Overshirt, shacket | as men's |

**Polos:** polo, knit polo, cropped polo, zip polo, Johnny collar, rugby, Henley: as men's (women's block).

**Sweaters and knitwear:** as men's plus:

| garment | build |
|---|---|
| Cowl neck sweater | N cowl |
| Off-shoulder sweater | a wide neck slipping off the shoulders |
| Cropped sweater | L waist |
| Oversized sweater | drop shoulder |
| Tunic sweater | L thigh |
| Batwing sweater | S dolman |
| Balloon-sleeve sweater | S balloon |
| Knitted tank / tee | as named |
| Crochet top | alpha |
| Open-front cardigan | no closure |
| Cropped cardigan | L waist |
| Longline (duster) cardigan | to the knee |
| Belted cardigan | + belt |
| Wrap cardigan | wrap + ties |
| Waterfall cardigan | open front with long draped front panels (cascade: circular front edge) |
| Cocoon cardigan | rounded oversized, a curved hem, dolman |
| Bolero / shrug | short |
| Twinset | a shell top + a matching cardigan (2 layers) |
| Pointelle | eyelet knit (alpha) |
| Angora, bouclé | F |
| Poncho / cape sweater | §1.11 |

**Sweatshirts / hoodies / fleece:** as men's plus cropped hoodie, oversized hoodie, off-shoulder sweatshirt, sleeveless
hoodie.

**Jackets:** as men's plus:

| garment | build |
|---|---|
| Cropped denim | L waist |
| Faux fur / teddy jacket | F fur (sherpa: shell texture + fins / normal) |
| Cropped puffer | short |
| Collarless tweed (bouclé) jacket | Chanel-style: boxy, collarless round neck, braid trim (TEX), patch pockets, chain at the hem (adds weight) |
| Peplum jacket | fitted + peplum |
| Bolero jacket | a very short open jacket |
| Cape jacket | a cape over the shoulders |
| Kimono jacket | kimono cut |
| Bed jacket | a short, soft quilted/satin jacket with ties |

**Vests:** waistcoat, longline vest (open, to mid-thigh), puffer, down gilet, fleece, quilted, denim, leather, faux fur,
utility, knitted, hi-vis vest.

**Coats:** as men's plus:

| garment | build |
|---|---|
| Wrap coat / robe coat | wrap + belt, shawl collar, no buttons |
| Cocoon coat | rounded, dolman/drop shoulder, a narrowed hem |
| Swing coat | A-line flared from the shoulders |
| Princess coat | princess seams, fitted bodice, flared skirt |
| Faux fur / teddy coat | F fur |
| Opera coat | a wide evening coat, large collar, ¾ sleeves |
| Kimono coat | kimono cut, long |
| Cape coat | a coat with a cape layer or armhole slits |
| Ruana | §1.11 |

**Tailored:**

| garment | build |
|---|---|
| Single-breasted, double-breasted, suit jacket, tuxedo jacket | women's tailored block (princess seams) |
| Oversized blazer | drop shoulder, longer |
| Cropped blazer | L waist |
| Longline blazer | L mid-thigh |
| Peplum blazer | + peplum |
| Sleeveless blazer | no sleeves |
| Cape blazer | a cape over the shoulders |
| Collarless jacket | round/V neck, no collar |
| Mandarin collar jacket | band collar |
| Blazer vest | a long tailored waistcoat with lapels |

**Sports and activewear:**

| garment | build |
|---|---|
| Sports bra / longline sports bra | compression crop, racerback, an elastic band under the bust (§1.12) |
| Athletic crop top, workout tank, training tee, compression top, base layer, running singlet | as named |
| Yoga top | fitted, built-in bra, twist back |
| Leotard | a scoop-neck bodysuit, high-cut legs, spandex |
| Dance wrap top | ballet wrap |
| Tennis top | fitted tank/polo |
| Golf polo, cycling jersey, team jerseys | as men's |
| Netball top | sleeveless jersey + a position bib |
| Warm-up top, training bib | as men's |

**Swim tops:** triangle bikini, bandeau bikini, halter bikini, underwire bikini, tankini (a tank-length swim top), swim
crop top, rash guard, wetsuit top (§1.12).

**Traditional and cultural (women):**
- §1.11: buba, boubou, kaftan, dashiki, jalabiya, djellaba, abaya, kurti/kurta/kameez, angrakha, kebaya, baju kurung,
  kimono, haori, jeogori, hanfu top, tang jacket, ao dai, huipil, quechquemitl, terno, vyshyvanka, dirndl blouse,
  serape.
- Ankara peplum top: a fitted top + peplum, print TEX.
- Lace blouse (iro and buba style): a buba in heavy lace (alpha + scalloped hem).
- George blouse: a buba-style blouse worn with a George wrapper (a heavy embroidered silk/velvet, TEX).
- Aso-oke blouse: a stiff hand-woven strip cloth (higher bending), often with puff sleeves.
- Kaba top: Ghanaian kaba = a fitted peplum/flounce blouse (kente/wax print), worn with a slit skirt.
- Kente blouse: TEX kente strips.
- Choli (sari blouse): a short fitted blouse with darts and short sleeves, a deep back.
- Qipao-style top: a mandarin collar, a diagonal opening, frog closures, fitted.
- Ao ba ba: a loose silk tunic shirt, side slits.
- Baro: Filipino blouse, butterfly/bell sleeves, sheer.

**Underwear / sleep / lounge:**

| garment | build |
|---|---|
| Undershirt, thermal top, lounge tee, robe, bathrobe | as men's |
| Sleep cami | satin cami |
| Pajama shirt | as men's |
| Sleep tee | oversized tee |
| Kimono robe | kimono cut, belt |
| Nursing top | a double layer with a lift-up or cross-over front |
| Maternity top | extra length + a ruched side seam over a bump (ease added at the belly) |

**Work and uniform:**
- Scrubs top, chef jacket, lab coat, work shirt, combat shirt, military tunic, clerical shirt: as men's.
- Salon/nurse tunic: a fitted tunic with side vents and pockets.
- Uniform blouse: a fitted blouse.

### MEN'S BOTTOMS

**Jeans** (base = Straight-leg jeans):

| garment | build |
|---|---|
| Straight-leg jeans | 5-pocket (scoop + coin front, 2 back patch pockets), back V yoke, contour waistband with 5–7 loops, button fly, mid rise, seat ease about 5 cm, straight leg (half hem 20–21 cm) · F heavy denim 12–14 oz · flat-felled inseam, rivets (TEX/relief) |
| Slim jeans | leg 18 cm, seat ease 3 |
| Skinny | leg 14–15 cm, stretch denim, seat ease 0 |
| Tapered | full seat/thigh, narrow hem |
| Athletic-fit | roomy seat and thigh, tapered |
| Relaxed / loose | +ease, leg 22–24 |
| Baggy | seat +20, leg 26+, low rise, stacking |
| Wide-leg | leg 26–30 |
| Bootcut | knee 21, hem 23–24 |
| Flared / bell-bottom | hem 28–35 |
| Barrel (balloon) | a curved outseam, wide at the knee, in at the hem |
| Dad jeans | high rise, relaxed, tapered |
| Carpenter, cargo, painter, double-knee jeans | extras (§1.8) |
| Biker (moto) jeans | quilted/ribbed knee panels (relief), zips |
| Stacked jeans | extra length (+10–15 cm) bunching at the ankle, slim at the hem |
| Cropped jeans | ankle − 5 cm |
| Cuffed jeans | turn-ups 4–5 cm showing the selvedge |
| Low / mid / high rise | rise |
| Raw, selvedge, stretch, distressed / ripped (alpha holes + frayed TEX), patchwork, acid wash, stone wash, black, white, coated / waxed (sheen), flannel-lined | TEX/F |

**Dress trousers and tailored** (base = Suit trousers):

| garment | build |
|---|---|
| Suit trousers | waistband with loops or side adjusters, slant/side-seam pockets, 2 back jetted pockets, zip fly, flat front or 1–2 pleats, centre crease (a pressed fold: dihedral target or texture), seat ease 5–6 cm, straight/tapered, half hem 19–21 · F wool suiting |
| Dress trousers, flat-front, single-pleat, double-pleat | as named |
| Tuxedo trousers | a satin side stripe (TEX), no loops, side adjusters |
| Morning (striped) trousers | grey stripe TEX, high waist, braces buttons |
| Wool, flannel, tweed, linen, seersucker, pinstripe, checked, cavalry twill, moleskin, corduroy trousers | F/TEX |
| High-waisted | rise + |
| Hollywood-waist | an extended waistband, no loops, pleats |
| Gurkha trousers | a high wrapover waistband with buckle tabs, double pleats |
| Side-adjuster | buckle tabs at the sides |
| Drawstring trousers | a drawstring waist |
| Cuffed (turn-up) | 4–5 cm turn-ups (a heavier band) |
| Cropped | short |
| Tapered / pegged | pleated full hip, narrow hem |
| Wide-leg | wide |
| Oxford bags | very wide (half hem 30–50 cm), pleated |
| Cigarette | slim straight, cropped |
| Plus-fours / plus-twos / knickerbockers | full legs gathered into a band below the knee with an overhang |

**Chinos and casual** (base = Chinos):

| garment | build |
|---|---|
| Chinos | = suit-trouser build in cotton twill, slant pockets, back welt pockets, slim/straight, no crease |
| Khakis, slim chinos, pleated chinos | as named |
| Five-pocket pants | the jeans build in twill |
| Cargo pants | relaxed + bellows thigh pockets with flaps, often cuffed/drawcord hem |
| Carpenter, painter, work pants, double-knee work pants | §1.8 |
| Fatigue pants | 2 flap back pockets, straight, sateen |
| Utility, tactical pants | cargo family (tactical: knee pads, many pockets) |
| Camo pants | TEX |
| Corduroy, linen pants | F |
| Pull-on / drawstring pants | elastic waist |
| Cropped / ankle pants | short |
| Wide-leg | wide |
| Balloon pants | barrel |
| Parachute pants | baggy nylon, drawcord hems, many zips |
| Harem / drop-crotch | §1.8 |
| Bell-bottoms / flares | flare |
| Sailor pants | high waist, a button front flap (bib front), wide flare |
| Leather, vinyl (sheen), velvet, satin, nylon, tech pants | F |
| Hiking / climbing pants | articulated knees (darts at the knee), gusseted crotch (a diamond insert), stretch |
| Convertible (zip-off) | a zip around the thigh (TEX line) |
| Bondage pants | straps between the legs + D-rings (strap strips pinned at the ends), tartan |
| Tartan trews | tartan TEX, slim |
| Side-stripe trousers | TEX stripe |

**Sweatpants / joggers / track** (base = Joggers):

| garment | build |
|---|---|
| Joggers | relaxed seat, tapered leg, elastic + drawcord waist (elastic = waist − 5…10 cm, 4–5 cm wide casing), rib ankle cuffs (70–85 %), side-seam pockets · F French terry/fleece |
| Sweatpants | open or cuffed hem, straighter leg |
| Cuffed / open-hem sweatpants | as named |
| Cargo joggers | + thigh pockets |
| Tech fleece joggers | slim, zip pocket, bonded seams |
| Fleece pants | F fleece |
| Track pants | tricot, side stripes, ankle zips |
| Tearaway (snap) pants | snaps down the outseam (TEX) |
| Warm-up pants | as named |
| Velour track pants | F velour |
| Windbreaker / shell pants | nylon, elastic cuffs |
| Training pants | slim joggers |
| Yoga pants | fitted/flared, spandex |
| Compression tights | negative ease −10 % |
| Running tights | compression + reflective TEX |

**Shorts** (base = Chino shorts, a 7–9" inseam):

| garment | build |
|---|---|
| Tailored (dress), pleated shorts | the trouser build, short |
| Bermuda | knee, slightly above |
| Gurkha | high wrap waist, wide leg |
| Linen, seersucker, madras, corduroy | F/TEX |
| Denim shorts (jorts) | jeans build, long and baggy (jorts) or cut-off |
| Cut-offs | raw frayed hem (alpha fringe) |
| Cargo, carpenter, skate (wide, long), hiking shorts | as named |
| Drawstring, pull-on, sweat, fleece, nylon, mesh, gym, training shorts | elastic waist |
| Running shorts | split side hem + liner (2 layers) |
| Split shorts | a deep side split |
| 2-in-1 | an outer short over compression tights (2 layers) |
| Basketball shorts | long, baggy, mesh |
| Football (soccer), rugby (tough, short, a pull-on with a reinforced seat) shorts | as named |
| Tennis, golf shorts | chino-like |
| Boxing / Muay Thai / MMA shorts | a very wide leg and high waist (Muay Thai: satin, very short, flared) / MMA: board-short style with side slits, velcro fly |
| Compression shorts | tight |
| Cycling shorts / bib shorts | tight + chamois pad (thicker at the crotch) + bib straps |
| Short shorts (5") | as named |
| Three-quarter (capris) | mid-calf |

**Swimwear:**

| garment | build |
|---|---|
| Swim trunks | elastic waist with drawcord, mesh liner, 5–7" |
| Board shorts | fixed waist with a laced fly, long (19–21" outseam), no liner, quick-dry |
| Volley shorts | short trunks |
| Hybrid shorts | trunks/chino |
| Swim briefs | brief, spandex |
| Square-cut trunks | a short straight leg |
| Jammers | knee-length compression |
| Swim leggings | as named |
| Wetsuit pants | neoprene |

**Sports:**

| garment | build |
|---|---|
| American football pants | knee-length compression with pad pockets (bulky collider) |
| Baseball pants | knee or full, piping, belt |
| Hockey pants | padded shell (very bulky) |
| Cricket trousers | white flannel |
| Golf trousers | as named |
| Goalkeeper pants | padded |
| Ski / snowboard pants | insulated, gaiters inside the leg, articulated knees |
| Snow bibs | + a bib |
| Cycling tights / bib tights, base layer | as named |
| Karate / judo / BJJ / taekwondo gi pants | wide straight legs, drawstring, heavy cotton (judo: very heavy, reinforced knees) |
| Fencing breeches | knee-length, suspenders |
| Riding breeches / jodhpurs | jodhpurs: flared at the hip, tight below the knee, knee patches |
| Motocross pants | padded, many panels |
| Motorcycle pants | leather/textile + armour |
| Rain pants | as named |
| Wrestling singlet | a spandex one-piece tank + shorts |

**Overalls / one-pieces:** bib overalls (dungarees), shortalls, coveralls, boiler suit, jumpsuit, flight suit (§1.13; flight
suit: many zip pockets).

**Skirts and wraps (men):**

| garment | build |
|---|---|
| Kilt | §1.9 (8 yd tartan, knife pleats at the back, aprons, straps), L knee |
| Utility kilt | canvas + cargo pockets |
| Men's skirt | A-line/wrap |
| Wrapper, sarong, lungi, dhoti, mundu, veshti, longyi, sulu, lava-lava, kikoi, macawiis (Somali sarong) | §1.11 |
| Izaar | wrap to the ankles |
| Fustanella | a pleated kilt-like skirt with 400 pleats (many-pleat skirt, white) |
| Hakama | §1.11 |

**Traditional and cultural (men):**

| garment | build |
|---|---|
| Sokoto | drawstring trousers, roomy seat (Yoruba; tapered or straight) |
| Kembe | wide calf-length Yoruba trousers |
| Senator trousers | straight, matching |
| Kaftan trousers | as named |
| Shalwar / churidar / Patiala / kurta pajama | §1.11 (kurta pajama = straight drawstring pants) |
| Dhoti pants | as named |
| Sirwal / sherwal | dropped-crotch harem trousers |
| Thai fisherman pants | wide wrap trousers: a very wide waist folded over and tied |
| Chong kben | a rectangle wrapped and pulled between the legs into pants |
| Baji | hanbok trousers, very wide, tied at the ankle |
| Hanfu trousers | wide |
| Momohiki / tobi pants | tobi: very wide, ballooning thighs, tight at the calves |
| Lederhosen | leather shorts with an H-brace (stiff leather) |
| Bombachas | gaucho pants: baggy, gathered at the ankle |

**Underwear:**

| garment | build |
|---|---|
| Briefs, bikini briefs, boxer briefs (fitted, a short leg), trunks (shorter boxer briefs), midway briefs (long leg) | knit, negative ease, elastic waistband (TEX logo band) |
| Boxer shorts | woven, loose, a button fly |
| Jockstrap, thong, dance belt | straps + pouch |
| Long johns, thermal leggings | waffle, tight |

**Sleep / lounge:** pajama pants (loose drawstring, straight, flannel), pajama shorts, sleep shorts, lounge pants, lounge shorts.

**Work / uniform:**

| garment | build |
|---|---|
| Scrubs pants | drawstring, cargo pocket |
| Chef pants | baggy drawstring, houndstooth TEX |
| Hi-vis trousers | reflective bands |
| Combat trousers (BDU) | cargo, knee reinforcement, drawcord hems |
| Dress uniform trousers | stripe |
| Firefighter turnout pants | bulky multilayer, reflective, braces |
| Chainsaw trousers | padded front panels |
| Welding pants | leather |
| Insulated pants | as named |
| Waders | a rubber bib + boots (stiff, F neoprene/rubber) |
| Chaps | leather leg covers, open seat (two leg tubes on a belt) |

**Fashion:**

| garment | build |
|---|---|
| Sequin, mesh, split-hem, patchwork pants | as named |
| Kick-flare trousers | a cropped flare |
| Culottes | a wide, cropped divided skirt |
| Skirted trousers | a wrap panel over trousers (2 layers) |
| Sarouel | = harem |
| Hakama-style | wide pleated |

### WOMEN'S BOTTOMS (women's trouser block: smaller waist relative to the hip, a curved CB, rise ease 2 cm, often higher rise)

**Jeans:** all men's variants plus:

| garment | build |
|---|---|
| Jeggings | leggings with a jean texture: negative ease, a mock fly TEX |
| Cigarette jeans | slim straight, ankle |
| Mom jeans | high rise, roomy hip, tapered, ankle |
| Boyfriend | relaxed, cuffed |
| Girlfriend | between mom and boyfriend |
| Palazzo jeans | very wide |
| Kick-flare | cropped flare |
| Ankle, capri | lengths |
| Paperbag-waist | gathered high waist + belt |
| Pull-on | elastic |
| Maternity | a stretch belly panel (high knit band) |
| Two-tone, embellished (rhinestone), split-hem, frayed-hem, coloured | TEX/alpha |

**Dress trousers and tailored:** as men's plus:

| garment | build |
|---|---|
| Straight-leg, peg-leg, palazzo, bootcut, flared, kick-flare, ankle, capri trousers | as named |
| Pedal pushers | mid-calf, slim |
| Paperbag trousers | paperbag waist |
| Sailor trousers | bib-front, flare |
| Belted / tie-waist | as named |
| Stirrup trousers | a foot strap |
| Split-hem | as named |
| Culottes / gaucho | wide, cropped |
| Crepe, satin | F |

**Chinos and casual:** as men's plus beach pants (linen drawstring), pajama-style pants, faux leather, silk, sequin,
crochet, mesh, sheer, lace (alpha) and fringe pants.

**Leggings and tights:** leggings (−5…−10 %, a high elastic waistband, no side seams), high-waisted, full-length, 7/8, capri,
stirrup, flared leggings, bootcut yoga pants, split-hem, seamless (no seam TEX), ribbed, printed, fleece-lined, faux
leather, treggings (trouser-look leggings), ponte pants (thicker double knit, slim), compression tights, running tights,
maternity leggings (an over-bump panel).

**Sweatpants / joggers / track:** as men's plus wide-leg and flared sweatpants.

**Shorts:** as men's plus:

| garment | build |
|---|---|
| Mom shorts, high-waisted shorts, city shorts (tailored, a knee-above, wide), paperbag shorts, tie-waist shorts | as named |
| Hot pants / short shorts | very short |
| Flowy shorts | wide, light, elastic waist |
| Culotte shorts | wide, longer |
| Scalloped | H scallops |
| Bubble shorts | gathered into a band at the leg |
| Lace, crochet, sequin, leather | F |
| Boxer-style | as named |
| Dolphin shorts | curved split side hem, binding |
| Biker / cycling shorts | tight, mid-thigh |
| Booty shorts | very short, tight |
| Volleyball (spandex) shorts | tight, short |
| Skort | a skirt panel over shorts |

**Skirts by length and shape** (§1.9 for the build):
- Micro, mini, knee, midi, tea-length, maxi, floor: L.
- Pencil, straight, column, bodycon (knit, negative ease), tube (knit), hobble (narrowing sharply at the hem; slit).
- A-line, skater (circle/half circle, short), circle, full, flared, gathered, dirndl, pleated, box pleat, knife pleat,
  accordion, plissé, tennis, kilt skirt, cheerleader (pleats/godets, short).
- Wrap, sarong skirt, slip, bias-cut, tiered, ruffle, rara, tulip, bubble, peplum skirt, trumpet, mermaid / fishtail,
  godet, gored, panel, yoke skirt (a fitted hip yoke + gathered or pleated lower).
- Handkerchief, asymmetric, high-low, slit, button-front (a front placket), paperbag (gathered waist), suspender
  (braces), layered, broomstick, prairie (tiered, long, gathered), peasant, poodle (a full circle felt skirt +
  petticoat; stiff felt, appliqué TEX).

**Skirts by fabric and occasion:**
- denim, cargo / utility (pockets), leather, suede, corduroy, tweed, satin, sequin, lace, crochet, knit, sweater,
  mesh, sheer, fringe, feather: F/TEX;
- tulle, tutu, petticoat, hoop, bustle (a back pad = a hidden collider), ball skirt: §1.9.

**Swim bottoms:** bikini bottoms, high-waisted, high-leg, hipster, cheeky, Brazilian, thong, tie-side (string), boyshort
(§1.12); swim skirt (a short flared skirt over a brief); swim shorts; board shorts; swim leggings; pareo (a sarong wrap,
§1.11); wetsuit pants.

**Sports:**
- Golf skort, running skirt (skort), netball skirt (pleated short), field hockey skirt, figure skating skirt (a short
  circle skirt attached to a leotard, chiffon).
- Dance skirt (wrap chiffon), ballet tights (sheer alpha or opaque, negative ease), yoga shorts.
- The rest as men's (ski, snowboard, bibs, cycling, base layer, softball pants (≈ baseball), cricket, golf, gi,
  fencing, riding, jodhpurs, motorcycle, rain).

**Overalls / one-pieces:** dungarees, shortalls, skirtall (a bib + skirt), jumpsuit, romper (playsuit), catsuit and unitard
(full-body spandex, negative ease), coveralls, boiler suit, flight suit.

**Traditional and cultural (women):**
- §1.11: iro (wrapper), oleku (a short iro to the knee, worn with a buba), George wrapper, Ankara wrapper, aso-oke
  wrapper (stiff), double wrapper (two layered wrappers), lappa, pagne, kanga, kitenge wrapper, kikoi, sari, lehenga,
  ghagra, salwar, churidar, Patiala, sharara, gharara, dhoti pants, lungi, mundu, sarong, sinh, sampot, longyi
  (htamein), malong, tapis, saya, kain, ao dai trousers, chima, mamianqun, hakama, monpe (gathered work trousers,
  tapered), pollera, pa'u, lava-lava, sulu, sirwal, Thai fisherman pants, bombachas.
- Kaba slit skirt: a fitted long skirt with a slit.

**Underwear, shapewear, hosiery:**
- Briefs, bikini, hipster, high-waisted, boyshorts, cheeky, thong, G-string, French knickers (tap pants: loose, flared
  short), bloomers (gathered at the leg), period underwear, maternity briefs: knit.
- Shapewear shorts / control briefs / girdle: high compression (−15 %).
- Slip shorts.
- Half slip / petticoat: a light skirt layer.
- Tights / pantyhose: full-leg negative ease (−20 %), sheer (alpha 0.2–0.5, a darker reinforced brief area TEX).
- Opaque tights, fishnet (alpha net), footless, stockings (thigh-high + a lace band), thermal leggings, long johns.

**Sleep / lounge:** as men's plus satin pajama pants.

**Work / uniform:** as men's plus uniform skirt (pencil/A-line).

---

## Part 4: building order (when the owner says go)

1. **Base blocks first.** Men's knit tee (set-in) → raglan → drop shoulder → woven shirt (collar + stand + placket +
   yoke + cuffs) → hoodie (hood + rib) → trousers (chino) → jeans → joggers → shorts.
2. **Each base block is ONE parametric Blender script** (GarmentCode-style parameters: fit/ease, length, sleeve
   length/shape, neckline, collar, closure, hem). Every catalogue line becomes a parameter set + a fabric preset + a
   texture.
3. **Variants:**
   - TEX variants cost nothing but a PNG (the Minecraft-skin idea).
   - F variants are a preset swap plus a re-drape.
   - Structural variants are a parameter change plus a re-drape.
4. **Every template is verified by measurement** against a reference photo (KNOWLEDGE §6 tools), plus a strain map
   (KNOWLEDGE §10.6).

---

## Sources (this round)

**Sleeves, necklines, collars:**
- [Raglan (The Creative Curator)](https://www.thecreativecurator.com/how-to-draft-raglan-sleeve-pattern/), [SewGuide raglan](https://sewguide.com/ragalan-sleeve-pattern/), [Sewing Lab Milano raglan/saddle](https://sewinglabmilano.com/lessons/2-10-raglan-1-2-pieces-sleeve-saddle-sleeve-2-2/)
- [Kimono sleeve](https://www.thecreativecurator.com/how-to-draft-kimono-sleeve-pattern/), [dolman + gussets](https://sewinglabmilano.com/lessons/2-9-dolman-block-gussets-2-2/), [Ready To Sew dolman](https://readytosew.fr/en/journal/how-to-draft-a-dolman-sleeve-b64.html)
- [Drop shoulder (PatternReview)](https://sewing.patternreview.com/SewingDiscussions/topic/108645), [Hey June dropped sleeve](https://www.heyjunehandmade.com/dropped-sleeve-brunswick-tutorial/)
- [Sleeve types](https://www.thecreativecurator.com/sleeves/), [7 sleeve alterations](https://www.theshapesoffabric.com/2018/11/03/7-easy-sleeve-pattern-alterations/)
- [Collar types](https://www.thecreativecurator.com/collars/), [Minerva collars](https://minervapatterns.com/blog/types-of-collars-from-peter-pan-to-mandarin)
- [Necklines](https://project-patterns.co.uk/post/necklines-explained-choose-draft-right-neckline), [ikat bag necklines](https://www.ikatbag.com/2010/09/drafting-part-viii-necklines-facings.html)
- [Two-piece sleeve (Threads)](https://www.threadsmagazine.com/2015/11/06/how-to-draft-a-two-piece-jacket-sleeve-from-a-one-piece-pattern)

**Skirts and bodices:**
- [Circle skirt formula](https://www.thecreativecurator.com/circle-skirt-formula/), [pleats](https://minervapatterns.com/blog/drafting-pleats-knife-box-and-inverted)
- [Gored skirts](https://www.theshapesoffabric.com/2018/04/22/lets-draft-some-panel-skirts/), [gathering ratios](https://sewingwithnumbers.substack.com/p/project-001-how-to-draft-gathers)
- [Princess seams](https://minervapatterns.com/blog/princess-seams-drafting-and-their-dart-equivalents), [corset vs bodice](https://www.corsettraining.net/how-to-make-a-bodice-not-corset/), [surplice](https://surefitdesigns.com/blogs/news/wrap-it-up-crossover-surplice-bodice-front)

**Jeans, tailoring, outerwear, active:**
- [Jeans anatomy](https://denimhunters.com/denim-wiki/jeans-anatomy/), [canvas coat front (Threads)](https://www.threadsmagazine.com/2013/07/26/the-canvas-coatfront-how-to-structure-jackets)
- [Down baffles](https://wearfoehn.com/blogs/journal/down-jacket-baffle-construction-explained-stitched-through-vs-box-wall-and-more), [trench details](https://www.thecuttingclass.com/burberry-trench-coat-details/)
- [Negative ease](https://blog.cashmerette.com/2019/02/what-is-negative-ease-and-how-does-it-work.html), [rib bands](http://www.craftingfashion.com/2013/02/adding-rib-bands-with-cut-and-sew-part-2.html), [knitwear construction](https://knitwear.io/sweater-construction-types/)
- [Henley](https://en.wikipedia.org/wiki/Henley_shirt), [triangle bikini](https://sewguide.com/sew-triangle-string-bikini-top/), [overalls](https://sewing.patternreview.com/SewingDiscussions/topic/112895), [cloak](https://www.eg.bucknell.edu/~lwittie/sca/garb/cloak.html), [joggers](https://winslets.com/blogs/sewing-tutorials/how-to-sew-joggers)

**Traditional:**
- [Agbada](https://en.wikipedia.org/wiki/Agbada), [how to cut agbada](https://ibkstitches.wordpress.com/2020/05/13/how-to-cut-and-sew-male-female-agbada/)
- [Kimono pieces](https://komonlab-site.pages.dev/guides/reading-vintage-japanese-sewing-patterns/), [kosode](https://tanbo-cho.com/2024/05/24/basic-garments-kosode-patterns/)
- [Kurta construction](https://seweverythingblog.com/2013/11/15/kurta-construction-cutting-out/), [kurta types](https://surkhsyahi.com/blogs/news/a-technical-look-at-kurta-constructions-from-kalidar-to-a-line)
- [Nivi saree](https://www.utsavfashion.com/blog/how-to/wear-nivi-style-saree), [thobe (alqamees)](https://alqamees.com/know-your-qamees/), [hanbok structure](https://www.korea.net/K-InfoHub/SubMainDetail/view?articleId=4058&pageIndex=2&headwordCd=64&headwordGroupCd=26)
- [Yoruba clothing](https://en.wikipedia.org/wiki/Yoruba_clothing), [kaftan/djellaba/abaya](https://sultanarouge.com/en/blogs/guide-mode-marocaine/caftan-djellaba-gandoura-abaya-differences)

**Parametric grammar:** GarmentCode `assets/design_params/default.yaml` + `assets/garment_programs/*.py` (cloned, read;
see KNOWLEDGE §10.2).
