/**
 * Tag derivation from folder names.
 * Pure functions — no global state.
 */

export const HASHTAG_MAP = {
    stage: '#see',
    install: '#exp',
    concept: '#make',
    tech: '#sound',
    spatial: '#perf',
};

export const FOLDER_TAGS = {
    '2gis': ['spatial'],
    'Addon 26': ['installation'],
    'belgium institution ? ': ['spatial', 'installation'],
    'bipolar express': ['stage', 'tech'],
    'Bluebeard_s Castle': ['stage', 'installation'],
    'Concepts': ['spatial', 'concept'],
    'fixtures decoratif': ['concept'],
    'gate': ['installation'],
    'gula merah': ['stage'],
    'Justice': ['stage'],
    'Kedrina': ['stage'],
    'la fleurs': ['spatial'],
    'mirag club': ['stage'],
    'Mirage Cinema': ['spatial'],
    'missoni': ['spatial', 'concept'],
    'New star camp': ['stage'],
    'Nina kravitz': ['stage'],
    'port': ['stage'],
    'Potato head bali': ['stage'],
    'signal': ['spatial', 'installation'],
    'Spatial design koridor': ['spatial', 'stage'],
    'Telegraph': ['spatial'],
    'thresholds': ['installation'],
    'torus': ['spatial', 'installation'],
    'tower building': ['spatial', 'installation'],
    'wish circles': ['spatial', 'installation'],
    'yndx interactive zone': ['spatial', 'installation'],
};

export function deriveTagsFromFolderName(folderNameRaw) {
    const name = (folderNameRaw || '').toLowerCase();
    const tags = [];
    if (name.includes('#stage') || name.includes('#see')) tags.push('stage');
    if (name.includes('#installation') || name.includes('#instalation') || name.includes('#instal'))
        tags.push('installation');
    if (name.includes('#exp')) tags.push('installation');
    if (name.includes('#concept') || name.includes('#make')) tags.push('concept');
    if (name.includes('#tech') || name.includes('#sound')) tags.push('tech');
    if (name.includes('#spatial') || name.includes('#perf')) tags.push('spatial');
    return tags;
}

export function getFolderTags(folderNameRaw, folderTagsMap = FOLDER_TAGS) {
    const folderName = (folderNameRaw || '').trim();
    const hashtagTags = deriveTagsFromFolderName(folderName);
    if (hashtagTags.length > 0) return hashtagTags;
    const strippedName = folderName.replace(/\s+#.*$/, '').trim();
    return folderTagsMap[folderName] || folderTagsMap[strippedName] || [];
}
