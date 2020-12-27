import Bot from './Bot';
import log from '../lib/logger';
import { PricelistChangedSource } from './Pricelist';

export default class CustomAutoprice {
    private readonly bot: Bot;

    constructor(bot: Bot) {
        this.bot = bot;

        /*
            data: {
                sku: string
                enabled: boolean | undefined
                buy: Currency
                sell: Currency
            }
        */
        this.bot.mySocket.on('custom-price', (data: any) => this.updataPrice(data));
    }

    private updataPrice(data: any) {
        log.debug(`CustomAutoprice: updating price for sku ${data.sku}`);
        const pricelist = this.bot.pricelist;
        const entry = pricelist.getPrice(data.sku);
        if (!entry) {
            log.warn(
                'CustomAutoprice: update pricelist failed! Atttempted to update the item that is not in the pricelist'
            );
            return;
        }
        if (entry.autoprice) {
            log.warn('CustomAutoprice: update pricelist failed! Atttempted to update the item with autoprice enabled.');
            return;
        }
        const { buy, sell, enabled, autoprice, max, min, intent } = entry;
        if (data.enabled == undefined) {
            data.enabled = enabled;
        } else if (data.enabled === false) {
            data.buy = { keys: buy.keys, metal: buy.metal };
            data.sell = { keys: sell.keys, metal: sell.metal };
        }
        data.autoprice = autoprice;
        data.max = max;
        data.min = min;
        data.intent = intent;
        pricelist.updatePrice(data, true, PricelistChangedSource.Command);
        log.debug('CustomAutoprice: pricelist updated!');
    }
}
