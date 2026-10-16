// Starter list: things you could spot in any public space. Short, visible at a glance.

export const DEFAULT_TITLE = 'People Watching Bingo';

export const PEOPLE_WATCHING = [
  // phones and screens
  'Talking on phone', 'On speakerphone', 'Video call in public', 'Taking a selfie',
  'Walking while texting', 'Laughing at phone', 'Two phones at once', 'Cracked phone screen',
  'Filming a video', 'Laptop out', 'Earbuds in', 'Big headphones',
  // food and drink
  'Drinking coffee', 'Giant drink', 'Energy drink', 'Eating while walking',
  'Ice cream', 'Fast food bag', 'Chewing gum', 'Coffee for the whole team',
  'Reusable water bottle', 'Snacking in secret',
  // kids and families
  'Baby in stroller', 'Crying baby', 'Toddler meltdown', 'Kid on shoulders',
  'Grandparent with grandkid', 'Family in matching shirts', 'School group', 'Kid with a balloon',
  // couples and greetings
  'Couple holding hands', 'Matching outfits', 'Couple bickering', 'First date energy',
  'Kissing in public', 'Hug hello', 'High five', 'Handshake', 'Elderly couple',
  // little mishaps
  'Picking nose', 'Trips over nothing', 'Drops something', 'Bumps into something',
  'Waves at the wrong person', 'Push/pull door fail', 'Untied shoelace', 'Stain on shirt',
  'Looking lost', 'Asking for directions', 'Running to catch something',
  // just people being people
  'Talking to themselves', 'Singing along', 'Dancing a little', 'Talking way too loud',
  'Someone napping', 'Big yawn', 'Sneezing', 'Stretching', 'Tapping foot impatiently',
  'Checking reflection', 'Holding the door', 'Stranger smiles at you', 'Pacing',
  'Sitting on the floor', 'Feet up on a seat', 'Shoes off', 'Reading a book',
  'Window shopping', 'Whistling',
  // outfits
  'Sunglasses indoors', 'Sunglasses on head', 'Socks with sandals', 'Crocs',
  'Pajama pants', 'Someone in a suit', 'Hi-vis vest', 'Lanyard', 'Fanny pack',
  'Sports jersey', 'Band T-shirt', 'Funny T-shirt', 'All black outfit', 'Leopard print',
  'Workout clothes', 'Backwards cap', 'Cowboy hat', 'Bucket hat', 'Beanie',
  'Hoodie up', 'Dressed for the wrong weather', 'Claw clip', 'Man bun',
  'Bright dyed hair', 'Visible tattoo', 'Big beard',
  // stuff people carry
  'Rolling suitcase', 'Too many bags', 'Carrying flowers', 'Pushing a cart',
  'Tote bag', 'Backpack on one shoulder', 'Umbrella',
  // getting around
  'Bike', 'Skateboard or scooter', 'Jogger', 'Delivery driver', 'Someone in uniform',
  'Tourist with a camera', 'Group photo',
  // animals
  'Dog on a leash', 'Dog in a bag', 'Two dogs meeting', 'Pigeon', 'Feeding the birds',
];

// Fun names for people who join a shared board: "Suspicious Pigeon", "Caffeinated Tourist".
export const ADJECTIVES = [
  'Suspicious', 'Curious', 'Sneaky', 'Sleepy', 'Caffeinated', 'Confused', 'Dramatic', 'Fancy',
  'Lost', 'Hungry', 'Chatty', 'Fidgety', 'Lurking', 'Casual', 'Mysterious', 'Breezy',
  'Jittery', 'Nosy', 'Dapper', 'Wandering', 'Squinting', 'Incognito', 'Undercover', 'Distracted',
];
export const NOUNS = [
  'Pigeon', 'Tourist', 'Barista', 'Commuter', 'Seagull', 'Squirrel', 'Bystander', 'Onlooker',
  'Mall Walker', 'Jogger', 'Busker', 'Shopper', 'Snacker', 'Goose', 'Raccoon', 'Detective',
  'Spectator', 'Owl', 'Flamingo', 'Birdwatcher', 'Lanyard', 'Lurker', 'Dog Walker', 'Window Shopper',
];

// Player colors: mid-tone so the dots read on both light and dark cards.
export const COLORS = [
  '#E0457B', '#8B5CF6', '#14B8A6', '#F59E0B', '#3B82F6', '#22C55E',
  '#EF4444', '#F97316', '#06B6D4', '#84CC16', '#D946EF', '#64748B',
];

export function funName(rand) {
  return `${ADJECTIVES[rand(ADJECTIVES.length)]} ${NOUNS[rand(NOUNS.length)]}`;
}
