import Currencies from 'tf2-currencies';
import pluralize from 'pluralize';
import Bot from '../../classes/Bot';

export function stock(bot: Bot): string[] {
    const pureStock: string[] = [];
    const pure = currPure(bot);
    const totalKeys = pure.key;
    const totalRefs = Currencies.toRefined(pure.refTotalInScrap);

    const keysPrefix = pluralize('key', totalKeys);
    const refinedPrefix = pluralize('ref', Math.trunc(totalRefs));

    const pureCombine = [
        {
            name: keysPrefix,
            amount: totalKeys
        },
        {
            name: '',
            amount: `${totalRefs}${
                totalRefs > 0
                    ? ` ${refinedPrefix} (${
                          pure.ref > 0 ? `${pure.ref} ref${pure.rec > 0 || pure.scrap > 0 ? ',' : ''}` : ''
                      }${pure.rec > 0 ? `${pure.ref > 0 ? ' ' : ''}${pure.rec} rec${pure.scrap > 0 ? ',' : ''}` : ''}${
                          pure.scrap > 0 ? `${pure.ref > 0 || pure.rec > 0 ? ' ' : ''}${pure.scrap} scrap` : ''
                      })`
                    : ''
            }`
        }
    ];
    for (let i = 0; i < pureCombine.length; i++) {
        if (i < 1 && totalKeys < 1) {
            continue;
        }
        pureStock.push(`${pureCombine[i].amount} ${pureCombine[i].name}`);
    }
    return pureStock;
}

export function currPure(bot: Bot): { key: number; scrap: number; rec: number; ref: number; refTotalInScrap: number } {
    const currencies = bot.inventoryManager.getInventory().getCurrencies();

    const currKeys = currencies['5021;6'].length;
    const currScrap = currencies['5000;6'].length;
    const currScrapValue = currScrap * (1 / 9);

    const currRec = currencies['5001;6'].length;
    const currRecValue = currRec * (1 / 3);

    const currRef = currencies['5002;6'].length;

    const currReftoScrap = Currencies.toScrap(currRef + currRecValue + currScrapValue);

    const pure = {
        key: currKeys,
        scrap: currScrap,
        rec: currRec,
        ref: currRef,
        refTotalInScrap: currReftoScrap
    };
    return pure;
}
