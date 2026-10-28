export type FeatureQuestion = {
  id: string;
  text: string;
  keywords: Record<string, string>;
};

function question(id: string, text: string, keywords: Record<string, string>): FeatureQuestion {
  return { id, text, keywords };
}

export const questions = [
  question('mammal', 'Is it a mammal?', { mammal: '哺乳动物' }),
  question('bird', 'Is it a bird?', { bird: '鸟类' }),
  question('reptile', 'Is it a reptile?', { reptile: '爬行动物' }),
  question('insect', 'Is it an insect?', { insect: '昆虫' }),
  question('water', 'Does it usually live in or near water?', { usually: '通常', 'in or near water': '水中或水边' }),
  question('flies', 'Can it fly?', { fly: '飞行' }),
  question('feathers', 'Does it have feathers?', { feathers: '羽毛' }),
  question('fur', 'Does it have fur?', { fur: '动物的毛' }),
  question('scales', 'Does it have scales?', { scales: '鳞片' }),
  question('shell', 'Does it have a hard shell?', { shell: '壳' }),
  question('fourLegs', 'Does it usually walk on four legs?', { usually: '通常', legs: '腿' }),
  question('twoLegs', 'Does it usually move on two legs?', { 'two legs': '两条腿' }),
  question('sixLegs', 'Does it have six legs?', { 'six legs': '六条腿' }),
  question('eightLegs', 'Does it have eight legs?', { 'eight legs': '八条腿' }),
  question('noLegs', 'Does it have no legs?', { 'no legs': '没有腿' }),
  question('pet', 'Is it commonly kept as a pet?', { commonly: '普遍地', pet: '宠物' }),
  question('farm', 'Is it commonly raised on farms?', { raised: '饲养', farms: '农场' }),
  question('meat', 'Does it mainly eat other animals?', { mainly: '主要地', 'other animals': '其他动物' }),
  question('plants', 'Does it mainly eat plants?', { mainly: '主要地', plants: '植物' }),
  question('large', 'Is an adult usually heavier than a person?', { adult: '成年个体', 'heavier than': '比……重' }),
  question('tiny', 'Could an adult fit in one hand?', { adult: '成年个体', 'fit in one hand': '放在一只手里' }),
  question('neck', 'Does it have a very long neck?', { neck: '脖子' }),
  question('trunk', 'Does it have a trunk?', { trunk: '象鼻' }),
  question('stripes', 'Does it have clear stripes on its body?', { stripes: '条纹' }),
  question('spots', 'Does it usually have spots on its body?', { spots: '斑点' }),
  question('mane', 'Does the adult male usually have a mane?', { male: '雄性', mane: '鬃毛' }),
  question('horns', 'Does it usually have horns?', { horns: '角' }),
  question('antlers', 'Do the males usually grow antlers?', { males: '雄性', antlers: '鹿角' }),
  question('pouch', 'Does the female carry its young in a pouch?', { female: '雌性', young: '幼崽', pouch: '育儿袋' }),
  question('hump', 'Does it have a hump on its back?', { hump: '驼峰' }),
  question('spines', 'Does it have sharp spines on its back?', { spines: '刺' }),
  question('blackWhite', 'Is it mostly black and white?', { mostly: '大部分地' }),
  question('bushyTail', 'Does it usually have a bushy tail?', { bushy: '浓密的', tail: '尾巴' }),
  question('longTail', 'Does it have a long tail compared with its body?', { tail: '尾巴', 'compared with': '与……相比' }),
  question('hooves', 'Does it have hooves?', { hooves: '蹄' }),
  question('climbs', 'Does it often climb trees?', { climb: '攀爬' }),
  question('hops', 'Does it usually move by hopping?', { hopping: '跳跃' }),
  question('nocturnal', 'Is it mainly active at night?', { active: '活跃的', 'at night': '在夜间' }),
  question('wool', 'Is it raised for its wool?', { raised: '饲养', wool: '羊毛' }),
  question('beard', 'Does it often have a beard under its chin?', { beard: '胡须', chin: '下巴' }),
  question('webbedFeet', 'Does it have webbed feet for swimming?', { 'webbed feet': '有蹼的脚' }),
  question('flatBeak', 'Does it have a broad, flat beak?', { broad: '宽的', beak: '鸟喙' }),
  question('hookedBeak', 'Does it have a hooked beak?', { hooked: '钩状的', beak: '鸟喙' }),
  question('colourful', 'Does it usually have brightly coloured feathers?', { 'brightly coloured': '颜色鲜艳的', feathers: '羽毛' }),
  question('flippers', 'Does it use flippers to swim?', { flippers: '鳍状肢' }),
  question('ink', 'Can it release ink to escape?', { release: '释放', ink: '墨汁', escape: '逃脱' }),
  question('arms', 'Does it have eight flexible arms?', { flexible: '柔软灵活的', arms: '腕足' }),
  question('web', 'Can it make silk to build a web?', { silk: '丝', web: '网' }),
  question('nectar', 'Does it feed on nectar from flowers?', { 'feed on': '以……为食', nectar: '花蜜' }),
  question('tusks', 'Does it usually have long tusks?', { tusks: '长牙' }),
  question('ears', 'Does it have very long ears?', { ears: '耳朵' }),
  question('bamboo', 'Does it mainly eat bamboo?', { bamboo: '竹子' }),
  question('eucalyptus', 'Does it mainly eat eucalyptus leaves?', { eucalyptus: '桉树', leaves: '叶子' }),
  question('honey', 'Does it make honey?', { honey: '蜂蜜' }),
  question('slither', 'Does it move by slithering?', { slithering: '蜿蜒滑行' }),
  question('roars', 'Can it make a loud roar?', { roar: '吼叫' }),
  question('redFur', 'Does it usually have reddish fur?', { reddish: '略带红色的', fur: '动物的毛' }),
  question('paws', 'Does it often use its paws to hold food?', { paws: '爪子' }),
  question('spiralShell', 'Does it have a spiral shell?', { spiral: '螺旋形的', shell: '壳' }),
  question('blowhole', 'Does it breathe through a blowhole?', { breathe: '呼吸', blowhole: '鲸类的呼吸孔' }),
  question('leaps', 'Does it often leap out of the sea?', { leap: '跃出' }),
  question('croak', 'Does it make a croaking sound?', { croaking: '呱呱叫的' }),
  question('mimic', 'Can it imitate human speech?', { imitate: '模仿', 'human speech': '人说话的声音' }),
  question('milk', 'Is it commonly kept to produce milk?', { 'produce milk': '产奶' }),
  question('pack', 'Does it usually hunt in a pack?', { hunt: '捕猎', pack: '（动物的）群' }),
  question('snout', 'Does it have a flat snout for digging?', { snout: '口鼻部', digging: '挖掘' }),
  question('fin', 'Does it have a tall fin on its back?', { fin: '鳍' }),
] as const;

export type Animal = {
  id: string;
  chinese: string;
  definition: string;
  yes: readonly string[];
  unknown: readonly string[];
  aliases: readonly string[];
};

function animal(id: string, chinese: string, definition: string, yes: string, unknown = '', aliases: string[] = []): Animal {
  return { id, chinese, definition, yes: yes.split(' '), unknown: unknown ? unknown.split(' ') : [], aliases };
}

// Features describe a typical adult. Unknown marks variable traits, not a negative answer.
// Chinese animal names were checked against ECDICT; questions and English definitions are curated for this game.
export const animals: readonly Animal[] = [
  animal('cat', '猫', 'A small animal with soft fur and sharp claws, often kept as a pet.', 'mammal fur fourLegs pet meat longTail climbs nocturnal paws', 'stripes spots tiny'),
  animal('dog', '狗', 'An animal often kept as a pet or trained to help people.', 'mammal fur fourLegs pet', 'large tiny longTail bushyTail ears meat plants'),
  animal('rabbit', '兔子', 'A small animal with long ears, soft fur and a short tail.', 'mammal fur fourLegs pet farm plants hops ears', 'tiny'),
  animal('horse', '马', 'A large animal with hooves, often used for riding.', 'mammal fur fourLegs farm plants large mane longTail hooves'),
  animal('cow', '奶牛', 'A large farm animal kept for its milk and meat.', 'mammal fur fourLegs farm plants large horns longTail hooves milk', 'blackWhite', ['cattle', '牛']),
  animal('pig', '猪', 'A farm animal with a flat nose that it uses to dig for food.', 'mammal fourLegs farm large hooves snout', 'fur plants meat'),
  animal('sheep', '绵羊', 'A farm animal with thick wool that is used to make clothes.', 'mammal fur fourLegs farm plants hooves wool', 'horns milk large', ['羊']),
  animal('goat', '山羊', 'A farm animal with horns that often has a beard.', 'mammal fur fourLegs farm plants horns hooves beard milk climbs', 'large'),
  animal('mouse', '老鼠', 'A very small animal with a pointed nose and a long, thin tail.', 'mammal fur fourLegs pet tiny longTail nocturnal climbs paws', 'plants', ['mice', '鼠']),
  animal('squirrel', '松鼠', 'A small tree-climbing animal with a large, bushy tail.', 'mammal fur fourLegs plants tiny bushyTail longTail climbs paws'),
  animal('hedgehog', '刺猬', 'A small animal with sharp spines that can curl into a ball.', 'mammal fur fourLegs tiny spines nocturnal', 'pet'),
  animal('bat', '蝙蝠', 'A small mammal with wings that is usually active at night.', 'mammal fur flies tiny nocturnal', 'meat plants nectar'),
  animal('bear', '熊', 'A large, strong animal with thick fur, round ears and a short tail.', 'mammal fur fourLegs large climbs paws', 'meat plants water'),
  animal('lion', '狮子', 'A large wild cat; the adult male usually has hair around its head.', 'mammal fur fourLegs meat large mane longTail nocturnal roars pack'),
  animal('tiger', '老虎', 'A large wild cat with dark stripes on orange fur.', 'mammal fur fourLegs meat large stripes longTail nocturnal roars'),
  animal('cheetah', '猎豹', 'A wild cat with spots that can run extremely fast.', 'mammal fur fourLegs meat spots longTail', 'large'),
  animal('elephant', '大象', 'A very large animal with a long trunk and large ears.', 'mammal fourLegs plants large trunk tusks longTail', 'fur'),
  animal('giraffe', '长颈鹿', 'A very tall African animal with a long neck and a spotted coat.', 'mammal fur fourLegs plants large neck spots horns longTail hooves'),
  animal('zebra', '斑马', 'An African animal like a horse, with black and white stripes.', 'mammal fur fourLegs plants large stripes mane blackWhite longTail hooves'),
  animal('monkey', '猴子', 'An animal with hands that can climb trees; most kinds have a long tail.', 'mammal fur fourLegs longTail climbs paws', 'plants meat tiny'),
  animal('panda', '熊猫', 'A black and white bear from China that mainly eats bamboo.', 'mammal fur fourLegs plants large blackWhite climbs bamboo paws', '', ['giant panda', '大熊猫']),
  animal('koala', '考拉', 'An Australian animal that lives in trees and eats eucalyptus leaves.', 'mammal fur fourLegs plants pouch climbs nocturnal eucalyptus paws', '', ['树袋熊']),
  animal('kangaroo', '袋鼠', 'An Australian animal with strong back legs; females carry their young in a pouch.', 'mammal fur twoLegs plants pouch hops longTail', 'large'),
  animal('fox', '狐狸', 'A wild animal with a pointed nose and a long, bushy tail.', 'mammal fur fourLegs meat bushyTail longTail nocturnal redFur'),
  animal('wolf', '狼', 'A wild animal related to the dog that often hunts in groups.', 'mammal fur fourLegs meat bushyTail longTail nocturnal pack'),
  animal('deer', '鹿', 'An animal with hooves; males of most kinds grow branching antlers.', 'mammal fur fourLegs plants antlers hooves', 'large', ['deers']),
  animal('camel', '骆驼', 'A large desert animal with one or two humps on its back.', 'mammal fur fourLegs farm plants large hump neck longTail'),
  animal('hippopotamus', '河马', 'A very large African animal with short legs that spends much of the day in water.', 'mammal fourLegs water plants large hooves', '', ['hippo']),
  animal('rhinoceros', '犀牛', 'A large animal with thick skin and one or two horns on its nose.', 'mammal fourLegs plants large horns hooves', '', ['rhino']),
  animal('otter', '水獭', 'An animal with thick fur and webbed feet that swims and catches food in water.', 'mammal fur fourLegs water meat longTail webbedFeet paws'),
  animal('seal', '海豹', 'A sea mammal with flippers that also rests on land or ice.', 'mammal fur water meat flippers', 'large'),
  animal('dolphin', '海豚', 'A sea mammal with a long mouth that often jumps above the water.', 'mammal water meat large noLegs flippers blowhole leaps fin'),
  animal('whale', '鲸', 'A very large sea mammal that breathes air through a hole on its head.', 'mammal water meat large noLegs flippers blowhole', 'fin leaps', ['鲸鱼']),
  animal('chicken', '鸡', 'A farm bird kept for its eggs and meat.', 'bird feathers twoLegs farm', 'flies plants meat colourful'),
  animal('duck', '鸭子', 'A water bird with webbed feet and a broad, flat beak.', 'bird feathers twoLegs water farm flies webbedFeet flatBeak', 'colourful plants meat', ['鸭']),
  animal('eagle', '鹰', 'A large bird that hunts other animals with strong claws and a hooked beak.', 'bird feathers twoLegs flies meat hookedBeak'),
  animal('owl', '猫头鹰', 'A bird with large eyes that usually hunts at night.', 'bird feathers twoLegs flies meat nocturnal hookedBeak'),
  animal('penguin', '企鹅', 'A black and white bird that cannot fly but swims very well.', 'bird feathers twoLegs water meat blackWhite webbedFeet flippers'),
  animal('parrot', '鹦鹉', 'A bird with a curved beak, often colourful and able to copy sounds.', 'bird feathers twoLegs flies pet plants hookedBeak colourful mimic'),
  animal('ostrich', '鸵鸟', 'A very large African bird with a long neck that runs instead of flying.', 'bird feathers twoLegs plants large neck', 'farm'),
  animal('crocodile', '鳄鱼', 'A large reptile with strong jaws and a long tail that lives near water.', 'reptile scales fourLegs water meat large longTail'),
  animal('snake', '蛇', 'A reptile with a long body and no legs.', 'reptile scales noLegs meat slither', 'pet water large tiny'),
  animal('turtle', '龟', 'A reptile with a hard shell that protects its body.', 'reptile scales fourLegs shell', 'pet water plants meat large tiny flippers', ['tortoise', '乌龟', '海龟']),
  animal('frog', '青蛙', 'A small animal with smooth skin and strong back legs for jumping.', 'fourLegs water meat tiny hops webbedFeet croak', 'nocturnal'),
  animal('shark', '鲨鱼', 'A fish with a strong body and sharp teeth that usually lives in the sea.', 'water noLegs meat fin', 'large'),
  animal('bee', '蜜蜂', 'A small flying insect that visits flowers; some kinds make honey.', 'insect flies sixLegs tiny nectar honey', 'stripes'),
  animal('butterfly', '蝴蝶', 'An insect with large wings that develops from a caterpillar.', 'insect flies sixLegs tiny nectar', 'colourful'),
  animal('spider', '蜘蛛', 'A small animal with eight legs that can produce silk.', 'eightLegs meat tiny web', 'nocturnal'),
  animal('octopus', '章鱼', 'A soft-bodied sea animal with eight arms that can release ink.', 'water noLegs meat arms ink', 'tiny large'),
  animal('snail', '蜗牛', 'A small, soft-bodied animal that moves slowly and usually has a spiral shell.', 'noLegs plants tiny shell spiralShell', 'water nocturnal'),
];

export const questionById = new Map(questions.map(item => [item.id, item]));
export const animalById = new Map(animals.map(item => [item.id, item]));

export function featureValue(animal: Animal, feature: string): 'yes' | 'no' | 'unknown' {
  return animal.unknown.includes(feature) ? 'unknown' : animal.yes.includes(feature) ? 'yes' : 'no';
}

export function findAnimal(term: string): Animal | undefined {
  const normalized = term.trim().toLocaleLowerCase().replace(/^(a|an|the)\s+/, '');
  return animals.find(animal => [animal.id, animal.chinese, ...animal.aliases].includes(normalized));
}
