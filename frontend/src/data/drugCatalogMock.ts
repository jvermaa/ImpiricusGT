import type { ImageSourcePropType } from 'react-native';

export type DrugSalt = {
  name: string;
  strength: string;
  purpose: string;
};

export type DrugFacts = {
  activeIngredientsTitle: string;
  uses: string[];
  warnings: string[];
  directions: string[];
  otherInformation: string[];
  inactiveIngredients: string[];
  questionsOrComments: string;
};

export type DrugProduct = {
  id: string;
  productName: string;
  companyName: string;
  websiteUrl: string;
  image: ImageSourcePropType;
  summary: string;
  salts: DrugSalt[];
  dosageForm: string;
  facts: DrugFacts;
};

export type DrugMatchBucket = 'exact' | 'contains_all' | 'combination';

export type DrugStrengthFilter = {
  selectedStrengths: string[];
  text: string;
};

export type RankedDrugMatch = {
  drug: DrugProduct;
  bucket: DrugMatchBucket;
  matchedCount: number;
  matchedTypedSalts: string[];
  score: number;
};

const BUCKET_ORDER: Record<DrugMatchBucket, number> = {
  exact: 0,
  contains_all: 1,
  combination: 2,
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function saltNameMatches(drugSaltName: string, querySaltName: string): boolean {
  const normalizedDrugSalt = normalize(drugSaltName);
  const normalizedQuerySalt = normalize(querySaltName);
  return (
    normalizedDrugSalt === normalizedQuerySalt ||
    normalizedDrugSalt.includes(normalizedQuerySalt) ||
    normalizedQuerySalt.includes(normalizedDrugSalt)
  );
}

export function parseSaltQuery(query: string): string[] {
  const seen = new Set<string>();
  return query
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => {
      const normalized = normalize(token);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function isExactSetMatch(drug: DrugProduct, typedSalts: string[]): boolean {
  if (drug.salts.length !== typedSalts.length) return false;

  const typed = typedSalts.map(normalize);
  const drugSaltNames = drug.salts.map((salt) => normalize(salt.name));

  return (
    typed.every((typedSalt) => drugSaltNames.some((drugSalt) => saltNameMatches(drugSalt, typedSalt))) &&
    drugSaltNames.every((drugSalt) => typed.some((typedSalt) => saltNameMatches(drugSalt, typedSalt)))
  );
}

export function rankDrugsBySaltQuery(
  query: string,
  drugs: DrugProduct[] = DRUG_CATALOG,
): RankedDrugMatch[] {
  const typedSalts = parseSaltQuery(query);
  if (typedSalts.length === 0) {
    return [];
  }

  const matches: RankedDrugMatch[] = [];

  for (const drug of drugs) {
    const matchedIndices: number[] = [];
    typedSalts.forEach((typedSalt, typedIndex) => {
      if (drug.salts.some((salt) => saltNameMatches(salt.name, typedSalt))) {
        matchedIndices.push(typedIndex);
      }
    });

    if (matchedIndices.length === 0) continue;

    const matchedTypedSalts = matchedIndices.map((index) => typedSalts[index]);
    const allTypedMatched = matchedIndices.length === typedSalts.length;
    const bucket: DrugMatchBucket = allTypedMatched
      ? isExactSetMatch(drug, typedSalts)
        ? 'exact'
        : 'contains_all'
      : 'combination';

    const typedOrderScore = matchedIndices.reduce((total, index) => {
      return total + (typedSalts.length - index);
    }, 0);
    const allTypedBonus = allTypedMatched ? 50 : 0;
    const extraSaltPenalty = allTypedMatched ? Math.max(0, drug.salts.length - typedSalts.length) : 0;
    const score = typedOrderScore * 10 + allTypedBonus - extraSaltPenalty;

    matches.push({
      drug,
      bucket,
      matchedCount: matchedIndices.length,
      matchedTypedSalts,
      score,
    });
  }

  return matches.sort((left, right) => {
    const bucketDelta = BUCKET_ORDER[left.bucket] - BUCKET_ORDER[right.bucket];
    if (bucketDelta !== 0) return bucketDelta;
    if (left.score !== right.score) return right.score - left.score;
    if (left.matchedCount !== right.matchedCount) return right.matchedCount - left.matchedCount;
    return left.drug.productName.localeCompare(right.drug.productName);
  });
}

export function groupDrugMatches(matches: RankedDrugMatch[]): Record<DrugMatchBucket, RankedDrugMatch[]> {
  return matches.reduce<Record<DrugMatchBucket, RankedDrugMatch[]>>(
    (groups, match) => {
      groups[match.bucket].push(match);
      return groups;
    },
    {
      exact: [],
      contains_all: [],
      combination: [],
    },
  );
}

export function getStrengthOptions(drugs: DrugProduct[] = DRUG_CATALOG): string[] {
  return Array.from(new Set(drugs.flatMap((drug) => drug.salts.map((salt) => salt.strength)))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

export function applyStrengthFilter(
  matches: RankedDrugMatch[],
  filter: DrugStrengthFilter,
): RankedDrugMatch[] {
  const selected = new Set(filter.selectedStrengths.map((item) => normalize(item)));
  const normalizedText = normalize(filter.text);

  if (selected.size === 0 && normalizedText.length === 0) return matches;

  return matches.filter(({ drug }) => {
    const strengths = drug.salts.map((salt) => normalize(salt.strength));
    const selectedMatch =
      selected.size === 0 || strengths.some((strength) => Array.from(selected).includes(strength));
    const textMatch =
      normalizedText.length === 0 ||
      strengths.some((strength) => strength.includes(normalizedText)) ||
      normalize(drug.dosageForm).includes(normalizedText);
    return selectedMatch && textMatch;
  });
}

export const DRUG_CATALOG: DrugProduct[] = [
  {
    id: 'drug-1',
    productName: 'NyQuil Severe Cold & Flu',
    companyName: 'Vicks',
    websiteUrl: 'https://vicks.com/en-us/shop-products/nyquil/nyquil-severe-cold-and-flu-relief-liquid',
    image: require('../../assets/drugs/nyquil-cough-pm.jpg'),
    summary: 'Max-strength nighttime liquid for cold and flu symptoms. One dose is 30 mL.',
    salts: [
      { name: 'Acetaminophen', strength: '650 mg / 30 mL', purpose: 'Pain reliever/fever reducer' },
      { name: 'Phenylephrine HCl', strength: '10 mg / 30 mL', purpose: 'Nasal decongestant' },
      { name: 'Doxylamine Succinate', strength: '12.5 mg / 30 mL', purpose: 'Antihistamine' },
      { name: 'Dextromethorphan HBr', strength: '20 mg / 30 mL', purpose: 'Cough suppressant' },
    ],
    dosageForm: 'Oral liquid, 30 mL every 4 hours (adult)',
    facts: {
      activeIngredientsTitle: 'Active ingredients (in each 30 mL dose)',
      uses: [
        'Temporarily relieves minor aches and pains, headache, sore throat, and fever.',
        'Temporarily relieves cough due to minor throat and bronchial irritation.',
        'Temporarily relieves nasal and sinus congestion and sinus pressure.',
        'Temporarily relieves runny nose and sneezing.',
      ],
      warnings: [
        'Liver warning: this product contains acetaminophen. Do not use with any other drug containing acetaminophen.',
        'Do not use with a monoamine oxidase inhibitor (MAOI), or for 2 weeks after stopping an MAOI.',
        'Ask a doctor before use with liver disease, heart disease, high blood pressure, thyroid disease, diabetes, glaucoma, or a breathing problem such as emphysema or chronic bronchitis.',
        'May cause marked drowsiness. Avoid alcoholic drinks and use care when driving or operating machinery.',
        'Do not use to make a child sleepy.',
      ],
      directions: [
        'Take only as directed and measure with the dose cup provided.',
        'Adults and children 12 years and over: 30 mL every 4 hours.',
        'Do not exceed 4 doses in 24 hours.',
        'Children under 4 years: do not use. Children 4 to under 12 years: ask a doctor.',
      ],
      otherInformation: [
        'Max Strength Severe Cold & Flu. One dose is 1 fl oz (30 mL).',
        'Each 30 mL contains sodium 92 mg.',
        'Store at no greater than 25 C and do not refrigerate.',
      ],
      inactiveIngredients: [
        'Citric acid',
        'FD&C blue no. 1',
        'FD&C red no. 40',
        'Glycerin',
        'Propylene glycol',
        'Saccharin sodium',
        'Sodium benzoate',
        'Sodium chloride',
        'Sodium citrate',
        'Sorbitol',
        'Sucralose',
        'Water',
        'Xanthan gum',
      ],
      questionsOrComments: 'Call 1-800-362-1683.',
    },
  },
  {
    id: 'drug-2',
    productName: 'Hydrocodone / Acetaminophen',
    companyName: 'Qualitest Pharmaceuticals',
    websiteUrl: 'https://www.drugs.com/imprints/3604-v-14258.html',
    image: require('../../assets/drugs/dexasleep-plus.jpg'),
    summary: 'White oval tablets with orange specks, imprinted 3604 V. Each tablet is hydrocodone bitartrate 5 mg with acetaminophen 325 mg.',
    salts: [
      { name: 'Hydrocodone Bitartrate', strength: '5 mg', purpose: 'Opioid analgesic' },
      { name: 'Acetaminophen', strength: '325 mg', purpose: 'Pain reliever' },
    ],
    dosageForm: 'Oral tablet, every 4 to 6 hours as prescribed',
    facts: {
      activeIngredientsTitle: 'Active ingredients (per tablet)',
      uses: ['Relief of moderate to moderately severe pain.'],
      warnings: [
        'Prescription opioid. Take only the amount a clinician prescribes.',
        'Liver warning: contains acetaminophen. Do not combine with other acetaminophen products.',
        'May cause sedation and slowed breathing. Avoid alcohol and other medicines that slow the nervous system.',
        'Can cause constipation, nausea, and dizziness. Misuse can lead to dependence, overdose, and death.',
      ],
      directions: [
        'Take exactly as prescribed.',
        'The usual labeled adult dose for this strength is 1 or 2 tablets every 4 to 6 hours as needed for pain.',
        'Do not exceed 8 tablets in 24 hours.',
      ],
      otherInformation: [
        'The clearest imprint in the photo is 3604 V: white, capsule-shaped, with orange specks.',
        'That imprint is hydrocodone bitartrate 5 mg / acetaminophen 325 mg from Qualitest.',
        'Store at 20 to 25 C and keep out of reach of children.',
      ],
      inactiveIngredients: [
        'Croscarmellose sodium',
        'Lactose monohydrate',
        'Magnesium stearate',
        'Microcrystalline cellulose',
        'Povidone',
        'Sodium lauryl sulfate',
        'Stearic acid',
        'Corn starch',
        'FD&C red no. 40',
        'FD&C yellow no. 6',
        'Sucrose',
      ],
      questionsOrComments: 'Confirm the imprint and prescription with the dispensing pharmacy.',
    },
  },
  {
    id: 'drug-3',
    productName: 'Gluco Tone',
    companyName: 'Clean Nutraceuticals',
    websiteUrl: 'https://cleannutra.com/products/gluco-tone',
    image: require('../../assets/drugs/cardiopress-duo.jpg'),
    summary: 'Liquid drops with berberine, Ceylon cinnamon, chromium, bitter melon, and turmeric. Bottle is 2 fl oz (60 mL).',
    salts: [
      { name: 'Berberine HCl', strength: '100 mg / 2 mL', purpose: 'Glucose metabolism support' },
      { name: 'Ceylon Cinnamon', strength: '100 mg / 2 mL', purpose: 'Glucose metabolism support' },
      { name: 'Chromium', strength: '110 mcg / 2 mL', purpose: 'Trace mineral' },
      { name: 'Bitter Melon', strength: '100 mg / 2 mL', purpose: 'Botanical' },
      { name: 'Turmeric', strength: 'proprietary blend', purpose: 'Botanical' },
    ],
    dosageForm: 'Liquid drops, 2 mL once daily',
    facts: {
      activeIngredientsTitle: 'Labeled ingredients (per 2 mL serving)',
      uses: [
        'Dietary supplement for healthy blood sugar response already in the normal range.',
        'Also marketed for metabolism and daily energy support.',
      ],
      warnings: [
        'These statements have not been evaluated by the FDA. This product is not intended to diagnose, treat, cure, or prevent any disease.',
        'Berberine can lower blood sugar. Review use with a clinician before combining with diabetes medication.',
        'Ask a clinician before use if pregnant, nursing, or taking prescription medicine.',
      ],
      directions: [
        'Take 2 mL (about 2 droppers full) once daily.',
        'Mix with water or another beverage, ideally with a meal, or as directed by a clinician.',
      ],
      otherInformation: [
        'Front label: Berberine, Ceylon Cinnamon, Chromium, Bitter Melon, Turmeric.',
        'Clean berry cinnamon flavor. Dietary supplement, 2 fl oz (60 mL).',
        'The same photo also shows the Vascu Glow bottle.',
      ],
      inactiveIngredients: ['Clean berry cinnamon flavor', 'Other excipients are not printed on the front label'],
      questionsOrComments: 'Clean Nutraceuticals product page: cleannutra.com/products/gluco-tone',
    },
  },
  {
    id: 'drug-4',
    productName: 'Vascu Glow',
    companyName: 'Clean Nutraceuticals',
    websiteUrl: 'https://cleannutra.com/products/vascu-glow',
    image: require('../../assets/drugs/cardiopress-duo.jpg'),
    summary: 'Liquid drops with cayenne, hawthorn, beet root, turmeric, and vitamins K2 and D3. Bottle is 2 fl oz (60 mL).',
    salts: [
      { name: 'Cayenne Pepper', strength: '100 mg / 2 mL', purpose: 'Circulation support' },
      { name: 'Hawthorn', strength: '100 mg / 2 mL', purpose: 'Cardiovascular botanical' },
      { name: 'Beet Root', strength: '100 mg / 2 mL', purpose: 'Nitrate source' },
      { name: 'Turmeric', strength: 'proprietary blend', purpose: 'Botanical' },
      { name: 'Vitamin K2', strength: '100 mcg / 2 mL', purpose: 'Vitamin' },
      { name: 'Vitamin D3', strength: '50 mcg / 2 mL', purpose: 'Vitamin' },
    ],
    dosageForm: 'Liquid drops, 2 mL once daily',
    facts: {
      activeIngredientsTitle: 'Labeled ingredients (per 2 mL serving)',
      uses: [
        'Dietary supplement marketed for circulation, blood flow, and cardiovascular wellness.',
        'Vitamin D3 and vitamin K2 are included alongside the botanical blend.',
      ],
      warnings: [
        'These statements have not been evaluated by the FDA. This product is not intended to diagnose, treat, cure, or prevent any disease.',
        'Vitamin K2 can interact with warfarin and other anticoagulants. Review use before starting.',
        'Ask a clinician before use if pregnant, nursing, or taking blood pressure or blood-thinning medicine.',
      ],
      directions: [
        'Take 2 mL (about 2 droppers full) once daily.',
        'Mix with water or another beverage, or take under the tongue, ideally with a meal.',
      ],
      otherInformation: [
        'Front label: Cayenne Pepper, Hawthorn, Beet Root, Turmeric, Vitamin K2+D3.',
        'Clean berry cinnamon flavor. Dietary supplement, 2 fl oz (60 mL).',
        'The same photo also shows the Gluco Tone bottle.',
      ],
      inactiveIngredients: ['Clean berry cinnamon flavor', 'Other excipients are not printed on the front label'],
      questionsOrComments: 'Clean Nutraceuticals product page: cleannutra.com/products/vascu-glow',
    },
  },
  {
    id: 'drug-5',
    productName: 'Cardio Tri-Plex',
    companyName: 'Protocol for Life Balance',
    websiteUrl: 'https://www.iherb.com/pr/protocol-for-life-balance-cardio-tri-plex-120-softgels/116873',
    image: require('../../assets/drugs/cardiopress-trio.jpg'),
    summary: 'Cardiovascular softgels combining red yeast rice, CoQ10, and omega-3 fish oil. 120 softgels.',
    salts: [
      { name: 'Red Yeast Rice', strength: '600 mg / 2 softgels', purpose: 'Cardiovascular support' },
      { name: 'CoQ10', strength: '60 mg / 2 softgels', purpose: 'Cardiovascular support' },
      {
        name: 'Omega-3 Fish Oil',
        strength: '2,000 mg / 2 softgels',
        purpose: 'EPA 360 mg and DHA 240 mg',
      },
    ],
    dosageForm: 'Softgel, 2 softgels twice daily',
    facts: {
      activeIngredientsTitle: 'Supplement facts (per 2 softgel serving)',
      uses: [
        'Dietary supplement for cardiovascular support.',
        'Combines organic red yeast rice, CoQ10, and fish oil concentrate.',
      ],
      warnings: [
        'Do not use with cholesterol-lowering medication, during pregnancy or lactation, with more than two alcoholic drinks a day, or if under 20 years old.',
        'People with liver disease, or anyone taking a prescription medicine, should consult a physician first.',
        'Omega-3 fatty acids can interact with aspirin, warfarin, and statin medicines.',
        'Contains fish (sardines, anchovies, mackerel) and soy.',
      ],
      directions: [
        'Take 2 softgels twice daily with food, or as directed by a healthcare practitioner.',
        '60 servings per 120-softgel bottle.',
      ],
      otherInformation: [
        'Front label lists 1. Red Yeast Rice, 2. CoQ10, 3. Omega-3 Fish Oil.',
        'Each 2-softgel serving has 20 calories and 2 g total fat.',
        'Red yeast rice in this formula is produced to avoid citrinin.',
      ],
      inactiveIngredients: [
        'Gelatin',
        'Glycerin',
        'Water',
        'Carob',
        'Soy lecithin',
        'Natural vitamin E',
      ],
      questionsOrComments: 'Protocol for Life Balance. See the product listing for the full supplement facts panel.',
    },
  },
  {
    id: 'drug-6',
    productName: 'Thyro Balance',
    companyName: 'Mikael Zayat Alchemist Oils',
    websiteUrl: 'https://www.mikaelzayatoil.com/product/109',
    image: require('../../assets/drugs/thyrobalance.jpg'),
    summary: 'Aromatic essential-oil blend. The bottle is labeled for aromatic use only.',
    salts: [
      { name: 'Myrtle', strength: 'essential oil', purpose: 'Aromatic constituent' },
      { name: 'Canadian Tsuga', strength: 'essential oil', purpose: 'Aromatic constituent' },
      { name: 'Arborvitae', strength: 'essential oil', purpose: 'Aromatic constituent' },
      { name: 'Nard', strength: 'essential oil', purpose: 'Aromatic constituent' },
    ],
    dosageForm: 'Essential oil, aromatic use',
    facts: {
      activeIngredientsTitle: 'Blend constituents',
      uses: [
        'Aromatic essential-oil blend sold under the name Thyro Balance.',
        'Not a thyroid hormone and not a substitute for levothyroxine or other thyroid treatment.',
      ],
      warnings: [
        'Labeled for aromatic use only.',
        'Do not ingest. Keep away from children, eyes, heat, and open flame.',
        'This product is not intended to diagnose, treat, cure, or prevent thyroid disease.',
      ],
      directions: [
        'Use as an aroma only, as printed on the bottle.',
        'The maker has also described 1 to 2 drops twice a day on the throat for 3 weeks, then a 2-week break. That is not a medicine dose.',
      ],
      otherInformation: [
        'The photo shows the name Thyro Balance, the Alchemist Oils mark, and “for aromatic use only.”',
        'The maker’s published blend for this oil is myrtle, Canadian tsuga, arborvitae, and nard. The small type on this bottle is not readable.',
      ],
      inactiveIngredients: ['No carrier oil is listed on the readable part of the label'],
      questionsOrComments: 'Mikael Zayat Alchemist Oils.',
    },
  },
];
