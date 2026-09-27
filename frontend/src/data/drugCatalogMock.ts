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
    productName: 'NyQuil Cough PM',
    companyName: 'Vicks Therapeutics',
    websiteUrl: 'https://www.vicks.com/en-us/shop-products/nyquil/nyquil-cough',
    image: require('../../assets/drugs/nyquil-cough-pm.jpg'),
    summary: 'Nighttime cough suppressant and antihistamine support.',
    salts: [
      { name: 'Dextromethorphan HBr', strength: '30 mg / 20 ml', purpose: 'Cough suppressant' },
      { name: 'Doxylamine Succinate', strength: '12.5 mg / 20 ml', purpose: 'Antihistamine' },
    ],
    dosageForm: 'Oral liquid, 20 ml every 6 hours (adult)',
    facts: {
      activeIngredientsTitle: 'Active ingredients (in each 20 ml)',
      uses: [
        'Temporarily relieves cough due to minor throat and bronchial irritation.',
        'Temporarily relieves sneezing, runny nose, and itchy/watery eyes due to upper respiratory allergies.',
        'Helps control the impulse to cough for nighttime rest.',
      ],
      warnings: [
        'Do not use to sedate a child or if currently on MAOI therapy.',
        'Ask a doctor before use if glaucoma, breathing problems, or chronic cough are present.',
        'May cause marked drowsiness; avoid alcohol and use care with machinery.',
      ],
      directions: [
        'Measure only with the dosing cup provided.',
        'Adults and children 12 years and over: 20 ml every 6 hours.',
        'Do not exceed 4 doses in 24 hours.',
      ],
      otherInformation: ['Store at 20-25 C (68-77 F).', 'Each 20 ml contains sodium 14 mg.'],
      inactiveIngredients: [
        'Citric acid',
        'FD&C blue no. 1',
        'FD&C red no. 40',
        'Glycerin',
        'Purified water',
        'Xanthan gum',
      ],
      questionsOrComments: 'Call 1-800-762-4675 weekdays from 9 AM to 5 PM EST.',
    },
  },
  {
    id: 'drug-2',
    productName: 'DexaSleep Plus',
    companyName: 'MediLeaf Pharma',
    websiteUrl: 'https://www.drugs.com/dextromethorphan.html',
    image: require('../../assets/drugs/dexasleep-plus.jpg'),
    summary: 'Nighttime cold/flu support with decongestant blend.',
    salts: [
      { name: 'Dextromethorphan HBr', strength: '30 mg / 20 ml', purpose: 'Cough suppressant' },
      { name: 'Doxylamine Succinate', strength: '12.5 mg / 20 ml', purpose: 'Antihistamine' },
      { name: 'Pseudoephedrine HCl', strength: '60 mg / 20 ml', purpose: 'Nasal decongestant' },
    ],
    dosageForm: 'Oral liquid, every 6 hours as directed',
    facts: {
      activeIngredientsTitle: 'Active ingredients (per 20 ml)',
      uses: [
        'Relieves cough and nighttime allergy symptoms.',
        'Temporarily relieves nasal congestion and sinus pressure.',
      ],
      warnings: [
        'Do not use with other products containing dextromethorphan.',
        'Consult doctor before use with high blood pressure or thyroid disease.',
      ],
      directions: [
        'Adults and children 12 years and over: 20 ml every 6 hours.',
        'Do not exceed 4 doses in 24 hours.',
      ],
      otherInformation: ['Store below 30 C.', 'Tamper-evident seal under cap.'],
      inactiveIngredients: ['Flavor blend', 'Glycerin', 'Purified water', 'Sorbitol'],
      questionsOrComments: 'Medical Information line: +1-800-555-0118',
    },
  },
  {
    id: 'drug-3',
    productName: 'CardioPress Duo',
    companyName: 'Apex Cardio Sciences',
    websiteUrl: 'https://www.drugs.com/amlodipine-valsartan.html',
    image: require('../../assets/drugs/cardiopress-duo.jpg'),
    summary: 'Dual-salt antihypertensive tablet for once-daily use.',
    salts: [
      { name: 'Amlodipine', strength: '5 mg', purpose: 'Calcium channel blocker' },
      { name: 'Valsartan', strength: '160 mg', purpose: 'Angiotensin II receptor blocker' },
    ],
    dosageForm: 'Film-coated tablet, once daily',
    facts: {
      activeIngredientsTitle: 'Active ingredients (per tablet)',
      uses: ['Management of hypertension in adults.', 'Useful when dual mechanism therapy is indicated.'],
      warnings: [
        'Monitor blood pressure and renal function as clinically appropriate.',
        'Avoid use in pregnancy unless specifically directed by clinician.',
      ],
      directions: [
        'One tablet by mouth once daily.',
        'Can be taken with or without food.',
      ],
      otherInformation: ['Store in original blister pack.', 'Protect from moisture.'],
      inactiveIngredients: ['Microcrystalline cellulose', 'Magnesium stearate', 'Hypromellose'],
      questionsOrComments: 'Clinical support: support@apexcardio.example',
    },
  },
  {
    id: 'drug-4',
    productName: 'CardioPress Trio',
    companyName: 'Apex Cardio Sciences',
    websiteUrl: 'https://www.drugs.com/mtm/amlodipine-hydrochlorothiazide-and-valsartan.html',
    image: require('../../assets/drugs/cardiopress-duo.jpg'),
    summary: 'Three-salt antihypertensive tablet with diuretic component.',
    salts: [
      { name: 'Amlodipine', strength: '5 mg', purpose: 'Calcium channel blocker' },
      { name: 'Valsartan', strength: '160 mg', purpose: 'Angiotensin II receptor blocker' },
      { name: 'Hydrochlorothiazide', strength: '12.5 mg', purpose: 'Thiazide diuretic' },
    ],
    dosageForm: 'Film-coated tablet, once daily',
    facts: {
      activeIngredientsTitle: 'Active ingredients (per tablet)',
      uses: ['Hypertension treatment when triple-combination approach is clinically appropriate.'],
      warnings: [
        'Monitor electrolytes and blood pressure.',
        'Discuss dizziness, dehydration, or hypotension symptoms promptly.',
      ],
      directions: ['One tablet once daily or as prescribed by clinician.'],
      otherInformation: ['Keep container tightly closed.', 'Store at room temperature.'],
      inactiveIngredients: ['Lactose monohydrate', 'Starch', 'Magnesium stearate'],
      questionsOrComments: 'Clinical hotline: +1-800-555-2170',
    },
  },
  {
    id: 'drug-5',
    productName: 'GlycoBoost XR',
    companyName: 'EndoBridge Bio',
    websiteUrl: 'https://www.drugs.com/metformin.html',
    image: require('../../assets/drugs/thyrobalance.jpg'),
    summary: 'Extended-release metformin for glycemic control.',
    salts: [{ name: 'Metformin Hydrochloride', strength: '500 mg', purpose: 'Biguanide antihyperglycemic' }],
    dosageForm: 'Extended-release tablet, once to twice daily',
    facts: {
      activeIngredientsTitle: 'Active ingredient (per tablet)',
      uses: ['Adjunct to diet and exercise for type 2 diabetes management.'],
      warnings: [
        'Review renal function before and during treatment.',
        'Take with meals to reduce gastrointestinal side effects.',
      ],
      directions: ['Swallow tablet whole; do not crush or chew.', 'Dose adjustments should be clinician-guided.'],
      otherInformation: ['Store between 20 C and 25 C.'],
      inactiveIngredients: ['Hypromellose', 'Povidone', 'Magnesium stearate'],
      questionsOrComments: 'Visit endocrine support center at endobridge.example/support',
    },
  },
  {
    id: 'drug-6',
    productName: 'ThyroBalance',
    companyName: 'NeuroThyra Labs',
    websiteUrl: 'https://www.drugs.com/levothyroxine.html',
    image: require('../../assets/drugs/thyrobalance.jpg'),
    summary: 'Levothyroxine formulation for thyroid hormone replacement.',
    salts: [{ name: 'Levothyroxine Sodium', strength: '50 mcg', purpose: 'Thyroid hormone replacement' }],
    dosageForm: 'Tablet, once daily on an empty stomach',
    facts: {
      activeIngredientsTitle: 'Active ingredient (per tablet)',
      uses: ['Replacement therapy in hypothyroidism.'],
      warnings: [
        'Not indicated for weight loss.',
        'Use caution in patients with cardiovascular disease; titrate as clinically appropriate.',
      ],
      directions: ['Take once daily on an empty stomach, 30-60 minutes before breakfast.'],
      otherInformation: ['Protect from light and moisture.'],
      inactiveIngredients: ['Calcium phosphate', 'Corn starch', 'Lactose monohydrate'],
      questionsOrComments: 'Product info portal: neurothyra.example',
    },
  },
];
