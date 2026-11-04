type QuestionPolicy = { readonly reliability: number; readonly group: string };

// Related observations provide less independent evidence than unrelated traits.
const groups = {
  mammals: 'mammal fur',
  birds: 'bird feathers colourful fanTail eyeTail',
  reptiles: 'reptile scales',
  insects: 'insect sixLegs',
  legs: 'fourLegs twoLegs eightLegs noLegs',
  diet: 'meat plants nectar blood',
  size: 'large tiny',
  domestication: 'pet farm milk wool',
  markings: 'stripes spots blackWhite redFur pink',
  tail: 'longTail bushyTail flatTail',
  horns: 'horns antlers',
  shell: 'shell spiralShell armour',
  flight: 'flies hovers oneWingPair wingCovers restingWings',
  swimming: 'water webbedFeet flippers fin',
};
const groupByQuestion = new Map(Object.entries(groups).flatMap(([group, ids]) => ids.split(' ').map(id => [id, group] as const)));
const variableTraits = new Set('water pet farm meat plants large tiny spots horns antlers blackWhite longTail bushyTail climbs hops nocturnal beard colourful nectar tusks ears roars redFur paws leaps pack burrows hangs hovers antennae restingWings queen'.split(' '));
const distinctiveTraits = new Set('neck trunk pouch hump spines wool web ink arms bamboo eucalyptus honey spiralShell blowhole croak mimic snout flatTail dams spray cheeks armour stickyTongue silverBack laughs fastestLand fanTail eyeTail beakPouch pecksWood changesColour horseHead oneWingPair fiveArms rings'.split(' '));
const policies = new Map<string, QuestionPolicy>();
const attenuation = new Map<number, number>();

export function questionPolicy(id: string): QuestionPolicy {
  let policy = policies.get(id);
  if (!policy) {
    policy = { reliability: distinctiveTraits.has(id) ? .91 : variableTraits.has(id) ? .89 : .9, group: groupByQuestion.get(id) ?? id };
    policies.set(id, policy);
  }
  return policy;
}

export function questionReliability(policy: QuestionPolicy, otherInGroup: number): number {
  let discount = attenuation.get(otherInGroup);
  if (discount === undefined) { discount = .985 ** otherInGroup; attenuation.set(otherInGroup, discount); }
  return .5 + (policy.reliability - .5) * discount;
}
