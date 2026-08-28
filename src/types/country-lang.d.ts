export type CountryNativeName = {
    common: string;
    official: string;
};

export type CountryNativeNames = Record<string, CountryNativeName>;

export type CountryLanguage = {
    code: string;
    name: string;
    nativeName: string;
    countryCode: string;
};

export type CountryCurrency = {
    name: string;
    symbol: string;
};

export type CountryCurrencies = Record<string, CountryCurrency>;

export type CountryCurrencyData = {
    code: string;
    name: string;
    symbol: string;
};

export type CountryNativeNameData = {
    code: string;
    common: string;
    official: string;
};

export type CountryName = {
    common: string;
    official: string;
    nativeName: CountryNativeNames;
};

export type Country = {
    id: string;
    capital: string;
    code: string;
    dialCode: string;
    continent: string;

    flag: string;
    largeFlag?: string;

    title: string;
    isActive: boolean;

    unicode: string;
    emoji: string;

    currency: string;
    currencySymbol: string;
    currencyName: string;

    timezone: string;
    timezones: string[];

    name: CountryName;

    languages: CountryLanguage[];

    currencies: CountryCurrencies;

    nativeNames: CountryNativeNameData[];

    currencyData: CountryCurrencyData[];

    createdAt: string;
};

export type Countries = Country[];
