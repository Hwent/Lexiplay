export const VOCABULARY_RANGE_IDS = ['all', 'primary', 'grade-12', 'ielts', 'cefr-a1-a2', 'cefr-b1-b2', 'cefr-c1-c2'] as const;
export type VocabularyRange = typeof VOCABULARY_RANGE_IDS[number];

function words(source: string): Set<string> { return new Set(source.trim().toLowerCase().split(/\s+/)); }
function combine(...lists: Set<string>[]): Set<string> { return new Set(lists.flatMap(list => [...list])); }

// Original, curated practice lists. Labels describe learning goals, not certified word-level mappings.
const everyday = words(`
  ant arm bag bed bee box boy bus car cat cow cup day dog ear egg eye fan fat few fly fox fun hat hen
  hot ice jam job key leg lip low man map net new old one owl pen pet pig red sad sea sky son sun ten
  tie toe top toy two use van war way wet win yes zoo
  baby back ball bear bird blue boat body book cake card city coat cold cook dark date desk door draw
  duck easy face farm fast feet find fish five food foot four frog game girl give goat gold good hand
  hard head help here home hope hour jump kind king kite lake leaf left life lion live look love milk
  moon name neck nice nine nose open park pink play pool rain read rice road room rose salt sand seat
  ship shoe shop sing snow soap some song star stop swim tail talk tall team tell time tree walk wall
  warm wash week what wind wish wood work year zero
  apple beach black bread brown chair child class clean clock close cloud dance dream drink earth eight
  every family father flower friend fruit garden glass grape grass green happy hello horse house juice
  laugh learn lemon light lunch money month mouse music night nurse ocean other paper party place plant
  plate quiet ready river round seven sheep short sister sleep small smile snake sport spoon stand stone
  story sugar sweet table teach thank their three tiger today tooth train truck uncle under visit voice
  watch water whale wheat wheel white woman world write young
  animal banana basket bottle brother butter camera carrot cheese chicken choose circle color colour country
  doctor dragon eleven finger forest hungry island jacket kitchen letter little market monkey morning mother
  number orange pencil people person picture rabbit school season second simple soccer spider spring square
  street summer Sunday teacher tennis twelve window winter yellow
  airplane alphabet bathroom bedroom birthday cupboard daughter elephant favorite football hospital mountain
  sandwich Saturday shopping shoulder tomorrow umbrella vegetable wonderful afternoon apartment beautiful
  breakfast butterfly chocolate Christmas classroom crocodile different important newspaper September Wednesday
`);

const independent = words(`
  aid aim ban bid due era fee gap law owe pay sum tax tip
  able area army beat calm case clue cost debt diet duty edit fact fear file gain goal heal heat hire host
  item lack loan loss mail mark meal mind pace peer plan plot port post risk role rule safe save seek sign
  size soil task term test tool tour type unit view vote wage waste wave wild wise zone
  ability absent accept access achieve active actual address advance advice afford agency agenda agree allow
  amount appear arrange arrive aspect attend avoid aware balance belief benefit blame borrow bother brand
  career cause chance change charge choice citizen claim client common compare concern confirm connect consider
  contain content contract control council courage create credit crime damage decide defend degree demand depend
  design detail develop device discuss doubt effect effort either employ enable energy enjoy ensure escape event
  example expect explain explore express factor figure focus force formal former freedom future general global
  growth handle health honest human ignore impact improve include income increase inform instead involve judge
  justice limit manage matter measure method modern nature normal notice object obtain offer option order origin
  patient period permit policy prepare pressure prevent private process produce product promise protect public
  purpose reason receive record reduce reflect refuse region relate release remain replace report require research
  respect respond result return reveal review select serious service settle society solve source space supply
  support survey system target theory thought threat toward trade travel treat trouble trust usual value various
  weather welcome whereas whether achieve character community confident education emergency framework influence
  knowledge operation practical principle procedure professor recognize statement structure technique tradition
  transport volunteer
`);

const advanced = words(`
  apt awe ebb eon foe hew ilk ire ode wry
  akin deem dire gist heed moot rend toil wane whim zeal
  acute adept adage allure amend ample ardent assert austere bias bleak candid caveat compel concede concise
  confer convey craft credence cynical dearth denote devise devout dichotomy diffuse diligent discord discourse
  discrete disdain dispute diverse dogma dubious earnest elicit elude empathy endorse entail epitome erudite ethos
  evoke exempt explicit facet feasible fervent finite flair flaw frugal garner generic grim hinder homage hostile
  humble imply implicit impose induce inert invoke irony jargon justify legacy liaison lucid lucrative merit motif
  murky negate nuance nuanced obsolete obscure offset ominous opaque paradigm paradox peril persist pertinent
  pivotal plight potent premise prevail profound prudent quell refine refute remorse render rhetoric rigid robust
  scrutiny secular serene shrewd sparse stark subtle surplus tacit tangible tenacious terse thesis transient trite
  turmoil uncanny uphold utter valid validate viable vigilant virtue vivid warrant yield
  abstract acronym adjacent advocate aesthetic ambiguous analogy anomaly arbitrary autonomy coherent cohesion
  consensus criterion deference disparate empirical ephemeral equitable erroneous euphemism hierarchy incentive
  inference ingenious intrinsic judicious narrative plausible precedent pragmatic resilient sceptical skeptical
  synthesis unanimous versatile
`);

const academic = words(`
  aid age air art ban bus car gas job law oil pay sea sum tax use war
  area bias city code cost data debt diet exam fact farm fee food fuel fund goal heat item land loan loss
  mean mode plan port rate rent risk road role rule safe site size soil task term test text time tour town
  unit view vote wage work year
  adapt adult agree alter annual apply asset audit aware basic cause chart civil claim class clear close cycle
  define demand derive draft doubt early earth edit energy essay ethic event exist extra field final focus force
  grant graph green group health human issue labor labour legal major media metal model occur panel phase prior
  prove quote range ratio scale scope share shift skill solid space state study style theme topic total trade trend
  urban valid value waste water write yield youth
  access analyse analysis assess assume author basis benefit budget campus career change channel chemical climate
  college concept conduct consist consume context contrast culture decline degree design detect develop domain
  economy educate effect employ enable engine entire entity estate expand expert export factor finance formula
  founded function gender global impact import income index invest involve lecture leisure method migrate minor
  notion obtain outcome output overall percent period permit policy predict project publish purpose region reject
  require resource respond review science sector sewage similar social source species specify stress subject summary
  survey symbol target theory transit tourism traffic transport trend valid vary version volume welfare
  argument audience approach category component conclude conflict conserve document domestic duration economic
  estimate evidence exchange external funding habitat identify indicate industry instance internal language maintain
  material negative network objective positive previous research resident response restrict revenue schedule strategy
  structure superior technique transfer variable vehicle academic allocate community dimension education efficient
  emergency equipment establish evaluate evolution existence extensive frequency guarantee highlight identical
  influence interpret knowledge mechanism paragraph potential principle procedure professor represent sensitive
  solution statement statistic temporary transport treatment volunteer forecast pollution renewable ecosystem
`);

const primary = combine(everyday, words(`
  addition subtract multiply divide fraction decimal triangle rectangle polygon perimeter diameter geometry
  grammar sentence spelling language history science compass calendar discover explorer dinosaur extinct fossil
  fossils habitat planet volcano mineral magnetic energy gravity skeleton muscle insect mammal reptile bacteria
  seed root stem soil branch feather oxygen carbon weather rainfall thunder lightning universe continent country
  geography biography fiction nonfiction character adjective verb noun pronoun adverb library dictionary
`));
const seniorSchool = combine(advanced, words(`
  allegory allusion analogy argument audience calculus capital chapter chemistry citizen coherent credible debate
  democracy dialogue electron energy equation ethical evaluate evidence explicit fiction friction genetics geometry
  grammar gravity imagery implicit inference irony literary logic metaphor molecule momentum moral motive narrative
  outline paragraph physics politics premise rhetoric satire science setting society sonnet stanza structure symbol
  syntax theorem thesis tragedy variable velocity writer writing algebra analysis author biology cell culture data
  economy essay ethics formula gene labor labour legal mass media method model motif novel oxygen prose ratio
  theme tone valid vector
`));

const rangeWords: Record<VocabularyRange, Set<string> | null> = {
  all: null, primary, 'grade-12': seniorSchool, ielts: academic,
  'cefr-a1-a2': everyday, 'cefr-b1-b2': independent, 'cefr-c1-c2': advanced,
};

export const VOCABULARY_RANGES = [
  { id: 'all', label: 'All vocabulary', description: 'Explore the full game dictionary.' },
  { id: 'primary', label: 'Primary school', description: 'Everyday words and primary-school subjects.' },
  { id: 'grade-12', label: 'Grade 12', description: 'Senior-school reading, science and essay vocabulary.' },
  { id: 'ielts', label: 'IELTS practice', description: 'Academic, study, society and environment vocabulary.' },
  { id: 'cefr-a1-a2', label: 'CEFR A1–A2', description: 'Basic practice: familiar objects and everyday situations.' },
  { id: 'cefr-b1-b2', label: 'CEFR B1–B2', description: 'Independent practice: work, opinions and general topics.' },
  { id: 'cefr-c1-c2', label: 'CEFR C1–C2', description: 'Advanced practice: precise and abstract vocabulary.' },
] satisfies { id: VocabularyRange; label: string; description: string }[];

export function vocabularyRangeDetails(id: VocabularyRange) {
  return VOCABULARY_RANGES.find(range => range.id === id) ?? VOCABULARY_RANGES[0]!;
}

export function filterVocabularyRange(terms: readonly string[], range: VocabularyRange): string[] {
  const selected = rangeWords[range];
  return selected ? terms.filter(term => selected.has(term)) : [...terms];
}
