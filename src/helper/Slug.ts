 
// Vendored slugify (multi-language charmap incl. Bengali). Adapted for the Node/server runtime.

// Node/backend base64 (the original browser btoa polyfill was dropped for the server).
function base64(input: string): string {
    return Buffer.from(input).toString('base64');
}

export interface SlugOptions {
    replacement?: string;
    multicharmap?: Record<string, string>;
    charmap?: Record<string, string>;
    remove?: RegExp | null;
    lower?: boolean;
    trim?: boolean;
    mode?: 'rfc3986' | 'pretty';
    locale?: string;
    fallback?: boolean;
}

interface ModeDefaults {
    replacement: string;
    remove: RegExp | null;
    lower: boolean;
    charmap: Record<string, string>;
    multicharmap: Record<string, string>;
    trim: boolean;
}

interface SlugDefaults {
    charmap: Record<string, string>;
    mode: 'rfc3986' | 'pretty';
    modes: {
        rfc3986: ModeDefaults;
        pretty: ModeDefaults;
    };
    multicharmap: Record<string, string>;
    fallback: boolean;
}

const locales: Record<string, Record<string, string>> = {
    // http://www.eki.ee/wgrs/rom1_bg.pdf
    bg: { Й: 'Y', й: 'y', X: 'H', x: 'h', Ц: 'Ts', ц: 'ts', Щ: 'Sht', щ: 'sht', Ъ: 'A', ъ: 'a', Ь: 'Y', ь: 'y' },
    // Need a reference URL for German, although this is pretty well-known.
    de: { Ä: 'AE', ä: 'ae', Ö: 'OE', ö: 'oe', Ü: 'UE', ü: 'ue' },
    // Need a reference URL for Serbian.
    sr: { đ: 'dj', Đ: 'DJ' },
    // https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/864314/ROMANIZATION_OF_UKRAINIAN.pdf
    uk: { И: 'Y', и: 'y', Й: 'Y', й: 'y', Ц: 'Ts', ц: 'ts', Х: 'Kh', х: 'kh', Щ: 'Shch', щ: 'shch', Г: 'H', г: 'h' },
};

let defaultLocale: Record<string, string> = {};

function slugify(string: string, opts?: SlugOptions | string): string {
    if (typeof string !== 'string') {
        throw new Error('slug() requires a string argument, received ' + typeof string);
    }
    if (!(string as any).isWellFormed()) {
        throw new Error('slug() received a malformed string with lone surrogates');
    }
    if (typeof opts === 'string') {
        opts = { replacement: opts };
    }
    opts = opts ? Object.assign({}, opts) : {};
    opts.mode = opts.mode || slug.defaults.mode;
    const defaults = slug.defaults.modes[opts.mode];
    const keys = ['replacement', 'multicharmap', 'charmap', 'remove', 'lower', 'trim'] as const;
    for (let key, i = 0, l = keys.length; i < l; i++) {
        key = keys[i];
        (opts as any)[key] = key in opts ? (opts as any)[key] : (defaults as any)[key];
    }
    const localeMap: Record<string, string> = locales[opts.locale!] || defaultLocale;

    let lengths: number[] = [];
    for (const key in opts.multicharmap) {
        if (!Object.prototype.hasOwnProperty.call(opts.multicharmap, key)) {
            continue;
        }

        const len = key.length;
        if (lengths.indexOf(len) === -1) {
            lengths.push(len);
        }
    }

    // We want to match the longest string if there are multiple matches, so
    // sort lengths in descending order.
    lengths = lengths.sort(function (a, b) {
        return b - a;
    });

    const disallowedChars = opts.mode === 'rfc3986' ? /[^\w\s\-.~]/ : /[^A-Za-z0-9\s]/;

    let result = '';
    for (let char: string, i = 0, l = string.length; i < l; i++) {
        char = string[i];
        let matchedMultichar = false;
        for (let j = 0; j < lengths.length; j++) {
            const len = lengths[j];
            const str = string.substr(i, len);
            if (opts.multicharmap![str]) {
                i += len - 1;
                char = opts.multicharmap![str];
                matchedMultichar = true;
                break;
            }
        }
        if (!matchedMultichar) {
            if (localeMap[char]) {
                char = localeMap[char];
            } else if (opts.charmap![char]) {
                char = opts.charmap![char].replace(opts.replacement!, ' ');
            } else if (char.includes(opts.replacement!)) {
                // preserve the replacement character in case it is excluded by disallowedChars
                char = char.replace(opts.replacement!, ' ');
            } else {
                char = char.replace(disallowedChars, '');
            }
        }
        result += char;
    }

    if (opts.remove) {
        result = result.replace(opts.remove, '');
    }
    if (opts.trim) {
        result = result.trim();
    }
    result = result.replace(/\s+/g, opts.replacement!); // convert spaces
    if (opts.lower) {
        result = result.toLowerCase();
    }
    return result;
}

// prettier-ignore
const initialMulticharmap: Record<string, string> = {
    // multibyte devanagari characters (hindi, sanskrit, etc.)
    फ़: 'Fi',
    ग़: 'Ghi',
    ख़: 'Khi',
    क़: 'Qi',
    ड़: 'ugDha',
    ढ़: 'ugDhha',
    य़: 'Yi',
    ज़: 'Za',
    // hebrew
    // Refs: http://www.eki.ee/wgrs/rom1_he.pdf
    // Refs: https://en.wikipedia.org/wiki/Niqqud
    בִי: 'i',בֵ: 'e',בֵי: 'e',בֶ: 'e',בַ: 'a',בָ: 'a',בֹ: 'o',וֹ: 'o',בֻ: 'u',
    וּ: 'u', בּ: 'b', כּ: 'k', ךּ: 'k', 
    פּ: 'p', שׁ: 'sh', שׂ: 's', בְ: 'e', 
    חֱ: 'e', חֲ: 'a', חֳ: 'o', בִ: 'i',
    // japanese combined kana (yoon) - hiragana
    '\u304D\u3083': 'kya', '\u304D\u3085': 'kyu', '\u304D\u3087': 'kyo',
    '\u3057\u3083': 'sha', '\u3057\u3085': 'shu', '\u3057\u3087': 'sho',
    '\u3061\u3083': 'cha', '\u3061\u3085': 'chu', '\u3061\u3087': 'cho',
    '\u306B\u3083': 'nya', '\u306B\u3085': 'nyu', '\u306B\u3087': 'nyo',
    '\u3072\u3083': 'hya', '\u3072\u3085': 'hyu', '\u3072\u3087': 'hyo',
    '\u307F\u3083': 'mya', '\u307F\u3085': 'myu', '\u307F\u3087': 'myo',
    '\u308A\u3083': 'rya', '\u308A\u3085': 'ryu', '\u308A\u3087': 'ryo',
    '\u304E\u3083': 'gya', '\u304E\u3085': 'gyu', '\u304E\u3087': 'gyo',
    '\u3058\u3083': 'ja', '\u3058\u3085': 'ju', '\u3058\u3087': 'jo',
    '\u3073\u3083': 'bya', '\u3073\u3085': 'byu', '\u3073\u3087': 'byo',
    '\u3074\u3083': 'pya', '\u3074\u3085': 'pyu', '\u3074\u3087': 'pyo',
    // japanese combined kana (yoon) - katakana
    '\u30AD\u30E3': 'kya', '\u30AD\u30E5': 'kyu', '\u30AD\u30E7': 'kyo',
    '\u30B7\u30E3': 'sha', '\u30B7\u30E5': 'shu', '\u30B7\u30E7': 'sho',
    '\u30C1\u30E3': 'cha', '\u30C1\u30E5': 'chu', '\u30C1\u30E7': 'cho',
    '\u30CB\u30E3': 'nya', '\u30CB\u30E5': 'nyu', '\u30CB\u30E7': 'nyo',
    '\u30D2\u30E3': 'hya', '\u30D2\u30E5': 'hyu', '\u30D2\u30E7': 'hyo',
    '\u30DF\u30E3': 'mya', '\u30DF\u30E5': 'myu', '\u30DF\u30E7': 'myo',
    '\u30EA\u30E3': 'rya', '\u30EA\u30E5': 'ryu', '\u30EA\u30E7': 'ryo',
    '\u30AE\u30E3': 'gya', '\u30AE\u30E5': 'gyu', '\u30AE\u30E7': 'gyo',
    '\u30B8\u30E3': 'ja', '\u30B8\u30E5': 'ju', '\u30B8\u30E7': 'jo',
    '\u30D3\u30E3': 'bya', '\u30D3\u30E5': 'byu', '\u30D3\u30E7': 'byo',
    '\u30D4\u30E3': 'pya', '\u30D4\u30E5': 'pyu', '\u30D4\u30E7': 'pyo',
    // bengali multi-codepoint characters
    '\u09DC': 'r',
    '\u09DD': 'rh',
    '\u09DF': 'y',
};

// https://github.com/django/django/blob/master/django/contrib/admin/static/admin/js/urlify.js
const initialCharmap: Record<string, string> = {
    // latin
    À: 'A',
    Á: 'A',
    Â: 'A',
    Ã: 'A',
    Ä: 'A',
    Å: 'A',
    Æ: 'AE',
    Ç: 'C',
    È: 'E',
    É: 'E',
    Ê: 'E',
    Ë: 'E',
    Ì: 'I',
    Í: 'I',
    Î: 'I',
    Ï: 'I',
    Ð: 'D',
    Ñ: 'N',
    Ò: 'O',
    Ó: 'O',
    Ô: 'O',
    Õ: 'O',
    Ö: 'O',
    Ő: 'O',
    Ø: 'O',
    Ō: 'O',
    Ù: 'U',
    Ú: 'U',
    Û: 'U',
    Ü: 'U',
    Ű: 'U',
    Ý: 'Y',
    Þ: 'TH',
    ß: 'ss',
    à: 'a',
    á: 'a',
    â: 'a',
    ã: 'a',
    ä: 'a',
    å: 'a',
    æ: 'ae',
    ç: 'c',
    è: 'e',
    é: 'e',
    ê: 'e',
    ë: 'e',
    ì: 'i',
    í: 'i',
    î: 'i',
    ï: 'i',
    ð: 'd',
    ñ: 'n',
    ò: 'o',
    ó: 'o',
    ô: 'o',
    õ: 'o',
    ö: 'o',
    ő: 'o',
    ø: 'o',
    ō: 'o',
    Œ: 'OE',
    œ: 'oe',
    ù: 'u',
    ú: 'u',
    û: 'u',
    ü: 'u',
    ű: 'u',
    ý: 'y',
    þ: 'th',
    ÿ: 'y',
    ẞ: 'SS',
    // greek
    α: 'a',
    β: 'b',
    γ: 'g',
    δ: 'd',
    ε: 'e',
    ζ: 'z',
    η: 'h',
    θ: 'th',
    ι: 'i',
    κ: 'k',
    λ: 'l',
    μ: 'm',
    ν: 'n',
    ξ: '3',
    ο: 'o',
    π: 'p',
    ρ: 'r',
    σ: 's',
    τ: 't',
    υ: 'y',
    φ: 'f',
    χ: 'x',
    ψ: 'ps',
    ω: 'w',
    ά: 'a',
    έ: 'e',
    ί: 'i',
    ό: 'o',
    ύ: 'y',
    ή: 'h',
    ώ: 'w',
    ς: 's',
    ϊ: 'i',
    ΰ: 'y',
    ϋ: 'y',
    ΐ: 'i',
    Α: 'A',
    Β: 'B',
    Γ: 'G',
    Δ: 'D',
    Ε: 'E',
    Ζ: 'Z',
    Η: 'H',
    Θ: 'Th',
    Ι: 'I',
    Κ: 'K',
    Λ: 'L',
    Μ: 'M',
    Ν: 'N',
    Ξ: '3',
    Ο: 'O',
    Π: 'P',
    Ρ: 'R',
    Σ: 'S',
    Τ: 'T',
    Υ: 'Y',
    Φ: 'F',
    Χ: 'X',
    Ψ: 'PS',
    Ω: 'W',
    Ά: 'A',
    Έ: 'E',
    Ί: 'I',
    Ό: 'O',
    Ύ: 'Y',
    Ή: 'H',
    Ώ: 'W',
    Ϊ: 'I',
    Ϋ: 'Y',
    // turkish
    ş: 's',
    Ş: 'S',
    ı: 'i',
    İ: 'I',
    ğ: 'g',
    Ğ: 'G',
    // russian
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'yo',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'j',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'c',
    ч: 'ch',
    ш: 'sh',
    щ: 'sh',
    ъ: 'u',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
    А: 'A',
    Б: 'B',
    В: 'V',
    Г: 'G',
    Д: 'D',
    Е: 'E',
    Ё: 'Yo',
    Ж: 'Zh',
    З: 'Z',
    И: 'I',
    Й: 'J',
    К: 'K',
    Л: 'L',
    М: 'M',
    Н: 'N',
    О: 'O',
    П: 'P',
    Р: 'R',
    С: 'S',
    Т: 'T',
    У: 'U',
    Ф: 'F',
    Х: 'H',
    Ц: 'C',
    Ч: 'Ch',
    Ш: 'Sh',
    Щ: 'Sh',
    Ъ: 'U',
    Ы: 'Y',
    Ь: '',
    Э: 'E',
    Ю: 'Yu',
    Я: 'Ya',
    // ukranian
    Є: 'Ye',
    І: 'I',
    Ї: 'Yi',
    Ґ: 'G',
    є: 'ye',
    і: 'i',
    ї: 'yi',
    ґ: 'g',
    // czech
    č: 'c',
    ď: 'd',
    ě: 'e',
    ň: 'n',
    ř: 'r',
    š: 's',
    ť: 't',
    ů: 'u',
    ž: 'z',
    Č: 'C',
    Ď: 'D',
    Ě: 'E',
    Ň: 'N',
    Ř: 'R',
    Š: 'S',
    Ť: 'T',
    Ů: 'U',
    Ž: 'Z',
    // slovak
    ľ: 'l',
    ĺ: 'l',
    ŕ: 'r',
    Ľ: 'L',
    Ĺ: 'L',
    Ŕ: 'R',
    // polish
    ą: 'a',
    ć: 'c',
    ę: 'e',
    ł: 'l',
    ń: 'n',
    ś: 's',
    ź: 'z',
    ż: 'z',
    Ą: 'A',
    Ć: 'C',
    Ę: 'E',
    Ł: 'L',
    Ń: 'N',
    Ś: 'S',
    Ź: 'Z',
    Ż: 'Z',
    // latvian
    ā: 'a',
    ē: 'e',
    ģ: 'g',
    ī: 'i',
    ķ: 'k',
    ļ: 'l',
    ņ: 'n',
    ū: 'u',
    Ā: 'A',
    Ē: 'E',
    Ģ: 'G',
    Ī: 'I',
    Ķ: 'K',
    Ļ: 'L',
    Ņ: 'N',
    Ū: 'U',
    // arabic
    أ: 'a',
    إ: 'i',
    ب: 'b',
    ت: 't',
    ث: 'th',
    ج: 'g',
    ح: 'h',
    خ: 'kh',
    د: 'd',
    ذ: 'th',
    ر: 'r',
    ز: 'z',
    س: 's',
    ش: 'sh',
    ص: 's',
    ض: 'd',
    ط: 't',
    ظ: 'th',
    ع: 'aa',
    غ: 'gh',
    ف: 'f',
    ق: 'k',
    ك: 'k',
    ل: 'l',
    م: 'm',
    ن: 'n',
    ه: 'h',
    و: 'o',
    ي: 'y',
    ء: 'aa',
    ة: 'a',
    // farsi
    آ: 'a',
    ا: 'a',
    پ: 'p',
    ژ: 'zh',
    گ: 'g',
    چ: 'ch',
    ک: 'k',
    ی: 'i',
    // lithuanian
    ė: 'e',
    į: 'i',
    ų: 'u',
    Ė: 'E',
    Į: 'I',
    Ų: 'U',
    // romanian
    ț: 't',
    Ț: 'T',
    ţ: 't',
    Ţ: 'T',
    ș: 's',
    Ș: 'S',
    ă: 'a',
    Ă: 'A',
    // vietnamese
    Ạ: 'A',
    Ả: 'A',
    Ầ: 'A',
    Ấ: 'A',
    Ậ: 'A',
    Ẩ: 'A',
    Ẫ: 'A',
    Ằ: 'A',
    Ắ: 'A',
    Ặ: 'A',
    Ẳ: 'A',
    Ẵ: 'A',
    Ẹ: 'E',
    Ẻ: 'E',
    Ẽ: 'E',
    Ề: 'E',
    Ế: 'E',
    Ệ: 'E',
    Ể: 'E',
    Ễ: 'E',
    Ị: 'I',
    Ỉ: 'I',
    Ĩ: 'I',
    Ọ: 'O',
    Ỏ: 'O',
    Ồ: 'O',
    Ố: 'O',
    Ộ: 'O',
    Ổ: 'O',
    Ỗ: 'O',
    Ơ: 'O',
    Ờ: 'O',
    Ớ: 'O',
    Ợ: 'O',
    Ở: 'O',
    Ỡ: 'O',
    Ụ: 'U',
    Ủ: 'U',
    Ũ: 'U',
    Ư: 'U',
    Ừ: 'U',
    Ứ: 'U',
    Ự: 'U',
    Ử: 'U',
    Ữ: 'U',
    Ỳ: 'Y',
    Ỵ: 'Y',
    Ỷ: 'Y',
    Ỹ: 'Y',
    Đ: 'D',
    ạ: 'a',
    ả: 'a',
    ầ: 'a',
    ấ: 'a',
    ậ: 'a',
    ẩ: 'a',
    ẫ: 'a',
    ằ: 'a',
    ắ: 'a',
    ặ: 'a',
    ẳ: 'a',
    ẵ: 'a',
    ẹ: 'e',
    ẻ: 'e',
    ẽ: 'e',
    ề: 'e',
    ế: 'e',
    ệ: 'e',
    ể: 'e',
    ễ: 'e',
    ị: 'i',
    ỉ: 'i',
    ĩ: 'i',
    ọ: 'o',
    ỏ: 'o',
    ồ: 'o',
    ố: 'o',
    ộ: 'o',
    ổ: 'o',
    ỗ: 'o',
    ơ: 'o',
    ờ: 'o',
    ớ: 'o',
    ợ: 'o',
    ở: 'o',
    ỡ: 'o',
    ụ: 'u',
    ủ: 'u',
    ũ: 'u',
    ư: 'u',
    ừ: 'u',
    ứ: 'u',
    ự: 'u',
    ử: 'u',
    ữ: 'u',
    ỳ: 'y',
    ỵ: 'y',
    ỷ: 'y',
    ỹ: 'y',
    đ: 'd',
    // kazakh
    Ә: 'AE',
    ә: 'ae',
    Ғ: 'GH',
    ғ: 'gh',
    Қ: 'KH',
    қ: 'kh',
    Ң: 'NG',
    ң: 'ng',
    Ү: 'UE',
    ү: 'ue',
    Ұ: 'U',
    ұ: 'u',
    Һ: 'H',
    һ: 'h',
    Ө: 'OE',
    ө: 'oe',
    // serbian
    ђ: 'dj',
    ј: 'j',
    љ: 'lj',
    њ: 'nj',
    ћ: 'c',
    џ: 'dz',
    Ђ: 'Dj',
    Ј: 'j',
    Љ: 'Lj',
    Њ: 'Nj',
    Ћ: 'C',
    Џ: 'Dz',
    ǌ: 'nj',
    ǉ: 'lj',
    ǋ: 'NJ',
    ǈ: 'LJ',
    // hindi
    अ: 'a',
    आ: 'aa',
    ए: 'e',
    ई: 'ii',
    ऍ: 'ei',
    ऎ: 'ae',
    ऐ: 'ai',
    इ: 'i',
    ओ: 'o',
    ऑ: 'oi',
    ऒ: 'oii',
    ऊ: 'uu',
    औ: 'ou',
    उ: 'u',
    ब: 'B',
    भ: 'Bha',
    च: 'Ca',
    छ: 'Chha',
    ड: 'Da',
    ढ: 'Dha',
    फ: 'Fa',
    ग: 'Ga',
    घ: 'Gha',
    ग़: 'Ghi',
    ह: 'Ha',
    ज: 'Ja',
    झ: 'Jha',
    क: 'Ka',
    ख: 'Kha',
    ख़: 'Khi',
    ल: 'L',
    ळ: 'Li',
    ऌ: 'Li',
    ऴ: 'Lii',
    ॡ: 'Lii',
    म: 'Ma',
    न: 'Na',
    ङ: 'Na',
    ञ: 'Nia',
    ण: 'Nae',
    ऩ: 'Ni',
    ॐ: 'oms',
    प: 'Pa',
    क़: 'Qi',
    र: 'Ra',
    ऋ: 'Ri',
    ॠ: 'Ri',
    ऱ: 'Ri',
    स: 'Sa',
    श: 'Sha',
    ष: 'Shha',
    ट: 'Ta',
    त: 'Ta',
    ठ: 'Tha',
    द: 'Tha',
    थ: 'Tha',
    ध: 'Thha',
    ड़: 'ugDha',
    ढ़: 'ugDhha',
    व: 'Va',
    य: 'Ya',
    य़: 'Yi',
    ज़: 'Za',
    // bengali
    '\u0985': 'a',
    '\u0986': 'aa',
    '\u0987': 'i',
    '\u0988': 'ii',
    '\u0989': 'u',
    '\u098A': 'uu',
    '\u098B': 'ri',
    '\u098F': 'e',
    '\u0990': 'oi',
    '\u0993': 'o',
    '\u0994': 'ou',
    '\u0995': 'k',
    '\u0996': 'kh',
    '\u0997': 'g',
    '\u0998': 'gh',
    '\u0999': 'ng',
    '\u099A': 'ch',
    '\u099B': 'chh',
    '\u099C': 'j',
    '\u099D': 'jh',
    '\u099E': 'n',
    '\u099F': 't',
    '\u09A0': 'th',
    '\u09A1': 'd',
    '\u09A2': 'dh',
    '\u09A3': 'n',
    '\u09A4': 't',
    '\u09A5': 'th',
    '\u09A6': 'd',
    '\u09A7': 'dh',
    '\u09A8': 'n',
    '\u09AA': 'p',
    '\u09AB': 'ph',
    '\u09AC': 'b',
    '\u09AD': 'bh',
    '\u09AE': 'm',
    '\u09AF': 'j',
    '\u09B0': 'r',
    '\u09B2': 'l',
    '\u09B6': 'sh',
    '\u09B7': 'sh',
    '\u09B8': 's',
    '\u09B9': 'h',
    '\u09CE': 't',
    '\u0982': 'ng',
    '\u0983': 'h',
    '\u0981': 'n',
    '\u09E6': '0',
    '\u09E7': '1',
    '\u09E8': '2',
    '\u09E9': '3',
    '\u09EA': '4',
    '\u09EB': '5',
    '\u09EC': '6',
    '\u09ED': '7',
    '\u09EE': '8',
    '\u09EF': '9',
    // japanese hiragana
    '\u3042': 'a',
    '\u3044': 'i',
    '\u3046': 'u',
    '\u3048': 'e',
    '\u304A': 'o',
    '\u304B': 'ka',
    '\u304D': 'ki',
    '\u304F': 'ku',
    '\u3051': 'ke',
    '\u3053': 'ko',
    '\u3055': 'sa',
    '\u3057': 'shi',
    '\u3059': 'su',
    '\u305B': 'se',
    '\u305D': 'so',
    '\u305F': 'ta',
    '\u3061': 'chi',
    '\u3064': 'tsu',
    '\u3066': 'te',
    '\u3068': 'to',
    '\u306A': 'na',
    '\u306B': 'ni',
    '\u306C': 'nu',
    '\u306D': 'ne',
    '\u306E': 'no',
    '\u306F': 'ha',
    '\u3072': 'hi',
    '\u3075': 'fu',
    '\u3078': 'he',
    '\u307B': 'ho',
    '\u307E': 'ma',
    '\u307F': 'mi',
    '\u3080': 'mu',
    '\u3081': 'me',
    '\u3082': 'mo',
    '\u3084': 'ya',
    '\u3086': 'yu',
    '\u3088': 'yo',
    '\u3089': 'ra',
    '\u308A': 'ri',
    '\u308B': 'ru',
    '\u308C': 're',
    '\u308D': 'ro',
    '\u308F': 'wa',
    '\u3090': 'wi',
    '\u3091': 'we',
    '\u3092': 'wo',
    '\u3093': 'n',
    '\u304C': 'ga',
    '\u304E': 'gi',
    '\u3050': 'gu',
    '\u3052': 'ge',
    '\u3054': 'go',
    '\u3056': 'za',
    '\u3058': 'ji',
    '\u305A': 'zu',
    '\u305C': 'ze',
    '\u305E': 'zo',
    '\u3060': 'da',
    '\u3062': 'di',
    '\u3065': 'du',
    '\u3067': 'de',
    '\u3069': 'do',
    '\u3070': 'ba',
    '\u3073': 'bi',
    '\u3076': 'bu',
    '\u3079': 'be',
    '\u307C': 'bo',
    '\u3071': 'pa',
    '\u3074': 'pi',
    '\u3077': 'pu',
    '\u307A': 'pe',
    '\u307D': 'po',
    // japanese katakana
    '\u30A2': 'a',
    '\u30A4': 'i',
    '\u30A6': 'u',
    '\u30A8': 'e',
    '\u30AA': 'o',
    '\u30AB': 'ka',
    '\u30AD': 'ki',
    '\u30AF': 'ku',
    '\u30B1': 'ke',
    '\u30B3': 'ko',
    '\u30B5': 'sa',
    '\u30B7': 'shi',
    '\u30B9': 'su',
    '\u30BB': 'se',
    '\u30BD': 'so',
    '\u30BF': 'ta',
    '\u30C1': 'chi',
    '\u30C4': 'tsu',
    '\u30C6': 'te',
    '\u30C8': 'to',
    '\u30CA': 'na',
    '\u30CB': 'ni',
    '\u30CC': 'nu',
    '\u30CD': 'ne',
    '\u30CE': 'no',
    '\u30CF': 'ha',
    '\u30D2': 'hi',
    '\u30D5': 'fu',
    '\u30D8': 'he',
    '\u30DB': 'ho',
    '\u30DE': 'ma',
    '\u30DF': 'mi',
    '\u30E0': 'mu',
    '\u30E1': 'me',
    '\u30E2': 'mo',
    '\u30E4': 'ya',
    '\u30E6': 'yu',
    '\u30E8': 'yo',
    '\u30E9': 'ra',
    '\u30EA': 'ri',
    '\u30EB': 'ru',
    '\u30EC': 're',
    '\u30ED': 'ro',
    '\u30EF': 'wa',
    '\u30F0': 'wi',
    '\u30F1': 'we',
    '\u30F2': 'wo',
    '\u30F3': 'n',
    '\u30AC': 'ga',
    '\u30AE': 'gi',
    '\u30B0': 'gu',
    '\u30B2': 'ge',
    '\u30B4': 'go',
    '\u30B6': 'za',
    '\u30B8': 'ji',
    '\u30BA': 'zu',
    '\u30BC': 'ze',
    '\u30BE': 'zo',
    '\u30C0': 'da',
    '\u30C2': 'di',
    '\u30C5': 'du',
    '\u30C7': 'de',
    '\u30C9': 'do',
    '\u30D0': 'ba',
    '\u30D3': 'bi',
    '\u30D6': 'bu',
    '\u30D9': 'be',
    '\u30DC': 'bo',
    '\u30D1': 'pa',
    '\u30D4': 'pi',
    '\u30D7': 'pu',
    '\u30DA': 'pe',
    '\u30DD': 'po',
    '\u30F4': 'vu',
    '\u30FC': '',
    // azerbaijani
    ə: 'e',
    Ə: 'E',
    // georgian
    ა: 'a',
    ბ: 'b',
    გ: 'g',
    დ: 'd',
    ე: 'e',
    ვ: 'v',
    ზ: 'z',
    თ: 't',
    ი: 'i',
    კ: 'k',
    ლ: 'l',
    მ: 'm',
    ნ: 'n',
    ო: 'o',
    პ: 'p',
    ჟ: 'zh',
    რ: 'r',
    ს: 's',
    ტ: 't',
    უ: 'u',
    ფ: 'p',
    ქ: 'k',
    ღ: 'gh',
    ყ: 'q',
    შ: 'sh',
    ჩ: 'ch',
    ც: 'ts',
    ძ: 'dz',
    წ: 'ts',
    ჭ: 'ch',
    ხ: 'kh',
    ჯ: 'j',
    ჰ: 'h',
    // hebrew
    ב: 'v',
    גּ: 'g',
    ג: 'g',
    ד: 'd',
    דּ: 'd',
    ה: 'h',
    ו: 'v',
    ז: 'z',
    ח: 'h',
    ט: 't',
    י: 'y',
    כ: 'kh',
    ך: 'kh',
    ל: 'l',
    מ: 'm',
    ם: 'm',
    נ: 'n',
    ן: 'n',
    ס: 's',
    פ: 'f',
    ף: 'f',
    ץ: 'ts',
    צ: 'ts',
    ק: 'k',
    ר: 'r',
    תּ: 't',
    ת: 't',
};

interface SlugFunction {
    (string: string, opts?: SlugOptions | string): string;
    charmap: Record<string, string>;
    multicharmap: Record<string, string>;
    defaults: SlugDefaults;
    reset: () => void;
    extend: (customMap: Record<string, string>) => void;
    setLocale: (locale: string) => void;
}

const slug = function (string: string, opts?: SlugOptions | string): string {
    let result = slugify(string, opts);
    const parsedOpts = typeof opts === 'string' ? undefined : opts;
    const fallback = parsedOpts && parsedOpts.fallback !== undefined ? parsedOpts.fallback : slug.defaults.fallback;
    // If output is an empty string, try slug for base64 of string.
    if (fallback === true && result === '') {
        result = slugify(base64(string), parsedOpts);
    }
    return result;
} as SlugFunction;

slug.charmap = Object.assign({}, initialCharmap);
slug.multicharmap = Object.assign({}, initialMulticharmap);
slug.defaults = {
    charmap: slug.charmap,
    mode: 'pretty',
    modes: {
        rfc3986: {
            replacement: '-',
            remove: null,
            lower: true,
            charmap: slug.charmap,
            multicharmap: slug.multicharmap,
            trim: true,
        },
        pretty: {
            replacement: '-',
            remove: null,
            lower: true,
            charmap: slug.charmap,
            multicharmap: slug.multicharmap,
            trim: true,
        },
    },
    multicharmap: slug.multicharmap,
    fallback: true,
};

slug.reset = function (): void {
    slug.defaults.modes.rfc3986.charmap =
        slug.defaults.modes.pretty.charmap =
        slug.charmap =
        slug.defaults.charmap =
            Object.assign({}, initialCharmap);
    slug.defaults.modes.rfc3986.multicharmap =
        slug.defaults.modes.pretty.multicharmap =
        slug.multicharmap =
        slug.defaults.multicharmap =
            Object.assign({}, initialMulticharmap);
    defaultLocale = {};
};

slug.extend = function (customMap: Record<string, string>): void {
    const keys = Object.keys(customMap);
    const multi: Record<string, string> = {};
    const single: Record<string, string> = {};
    for (let i = 0; i < keys.length; i++) {
        if (keys[i].length > 1) {
            multi[keys[i]] = customMap[keys[i]];
        } else {
            single[keys[i]] = customMap[keys[i]];
        }
    }
    Object.assign(slug.charmap, single);
    Object.assign(slug.multicharmap, multi);
};

slug.setLocale = function (locale: string): void {
    defaultLocale = locales[locale] || {};
};

export default slug;
