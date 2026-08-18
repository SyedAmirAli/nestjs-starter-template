export type ColorOptions = {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    blink?: boolean;
    reverse?: boolean;
};

export class Color {
    // Non-bold color codes
    public static readonly RED = '\x1b[31m';
    public static readonly GREEN = '\x1b[32m';
    public static readonly YELLOW = '\x1b[33m';
    public static readonly BLUE = '\x1b[34m';
    public static readonly MAGENTA = '\x1b[35m';
    public static readonly CYAN = '\x1b[36m';
    public static readonly WHITE = '\x1b[38;2;255;255;255m'; // Pure white (RGB: 255,255,255)
    public static readonly RESET = '\x1b[0m';
    public static readonly BOLD = '\x1b[1m';
    public static readonly ITALIC = '\x1b[3m';
    public static readonly UNDERLINE = '\x1b[4m';
    public static readonly STRIKETHROUGH = '\x1b[9m';
    public static readonly BLINK = '\x1b[5m';
    public static readonly REVERSE = '\x1b[7m';

    private static applyStyle(
        message: any,
        color: string,
        bold: boolean = false,
        italic: boolean = false,
        underline: boolean = false,
        strikethrough: boolean = false,
        blink: boolean = false,
        reverse: boolean = false,
    ): string {
        // Convert message to string
        let str: string;

        if (typeof message === 'object' && message !== null) {
            str = JSON.stringify(message, null, 4);
        } else if (typeof message === 'boolean') {
            str = String(message);
        } else if (message === null) {
            str = 'null';
        } else if (message === undefined) {
            str = 'undefined';
        } else if (typeof message === 'function') {
            str = 'function';
        } else {
            str = String(message);
        }

        // Build style string
        let style = '';
        if (bold) style += Color.BOLD;
        if (italic) style += Color.ITALIC;
        if (underline) style += Color.UNDERLINE;
        if (strikethrough) style += Color.STRIKETHROUGH;
        if (blink) style += Color.BLINK;
        if (reverse) style += Color.REVERSE;

        return `${color}${style}${str}${Color.RESET}`;
    }

    public static red(message: any, options: ColorOptions = {}): string {
        return Color.applyStyle(
            message,
            Color.RED,
            options.bold,
            options.italic,
            options.underline,
            options.strikethrough,
            options.blink,
            options.reverse,
        );
    }

    public static green(message: any, options: ColorOptions = {}): string {
        return Color.applyStyle(
            message,
            Color.GREEN,
            options.bold,
            options.italic,
            options.underline,
            options.strikethrough,
            options.blink,
            options.reverse,
        );
    }

    public static yellow(message: any, options: ColorOptions = {}): string {
        return Color.applyStyle(
            message,
            Color.YELLOW,
            options.bold,
            options.italic,
            options.underline,
            options.strikethrough,
            options.blink,
            options.reverse,
        );
    }

    public static blue(message: any, options: ColorOptions = {}): string {
        return Color.applyStyle(
            message,
            Color.BLUE,
            options.bold,
            options.italic,
            options.underline,
            options.strikethrough,
            options.blink,
            options.reverse,
        );
    }

    public static magenta(message: any, options: ColorOptions = {}): string {
        return Color.applyStyle(
            message,
            Color.MAGENTA,
            options.bold,
            options.italic,
            options.underline,
            options.strikethrough,
            options.blink,
            options.reverse,
        );
    }

    public static cyan(message: any, options: ColorOptions = {}): string {
        return Color.applyStyle(
            message,
            Color.CYAN,
            options.bold,
            options.italic,
            options.underline,
            options.strikethrough,
            options.blink,
            options.reverse,
        );
    }

    public static white(message: any, options: ColorOptions = {}): string {
        return Color.applyStyle(
            message,
            Color.WHITE,
            options.bold,
            options.italic,
            options.underline,
            options.strikethrough,
            options.blink,
            options.reverse,
        );
    }

    public static reset(message: any): string {
        return `${Color.RESET}${message}${Color.RESET}`;
    }

    public static bold(message: any): string {
        return `${Color.BOLD}${message}${Color.RESET}`;
    }

    public static italic(message: any): string {
        return `${Color.ITALIC}${message}${Color.RESET}`;
    }

    public static underline(message: any): string {
        return `${Color.UNDERLINE}${message}${Color.RESET}`;
    }

    public static strikethrough(message: any): string {
        return `${Color.STRIKETHROUGH}${message}${Color.RESET}`;
    }

    public static blink(message: any): string {
        return `${Color.BLINK}${message}${Color.RESET}`;
    }

    public static reverse(message: any): string {
        return `${Color.REVERSE}${message}${Color.RESET}`;
    }

    public static print(
        message: any,
        color: 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' = 'white',
        options: ColorOptions = {},
    ): void {
        console.log(Color[color](message, options));
    }

    static line(...args: any[]): void {
        console.log(args.join('\n'));
    }

    static tab(...args: any[]): void {
        console.log(args.join('\t'));
    }
}

const Colors = {
    Color,
};

export default Colors;
