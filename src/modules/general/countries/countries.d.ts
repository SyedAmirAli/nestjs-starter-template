export interface Country {
    id: string;
    capital: string;
    code: string;
    dialCode: string;
    continent: string;
    flag: string;
    largeFlag: string;
    title: string;
    name: CountryName;
    unicode: string;
    emoji: string;
    isActive: boolean;
    timezone: string;
    currency: string;
    currencySymbol: string;
    currencyName: string;

    timezones: string[];
    currencies: Record<string, Currency>;
    currencyData: CurrencyData[];
    nativeNames: NativeName[];
    languages: Language[];
}

export interface CountryType extends Country {
    createdAt: Date | string;
}

export interface CountryName {
    common: string;
    official: string;
    nativeName: Record<string, NativeCountryName>;
}

export interface NativeCountryName {
    common: string;
    official: string;
}

export interface Currency {
    name: string;
    symbol: string;
}

export interface CurrencyData {
    code: string;
    name: string;
    symbol: string;
}

export interface NativeName {
    code: string;
    common: string;
    official: string;
}

export interface Language {
    code: string;
    name: string;
    nativeName: string;
    countryCode: string;
}

/**
 * A row from GET /countries/languages — a Language plus where it came from.
 * `emoji` is the country's flag emoji; `flag` is the raw SVG and only present when
 * the caller asks for it (`?flag=true`), since it's a large Text column.
 */
export interface LanguageResult extends Language {
    countryId: string;
    emoji: string | null;
    flag?: string;
}
