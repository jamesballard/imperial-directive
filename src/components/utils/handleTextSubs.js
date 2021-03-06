// @flow

import actionPng from '../../assets/icons/action.png';
import blockPng from '../../assets/icons/block.png';
import damagePng from '../../assets/icons/damage.png';
import {ELITE_RED} from '../../styles/colors';
import insightPng from '../../assets/icons/insight.png';
import meleePng from '../../assets/icons/melee.png';
import strainPng from '../../assets/icons/strain.png';
import strengthPng from '../../assets/icons/strength.png';
import surgePng from '../../assets/icons/surge.png';
import techPng from '../../assets/icons/tech.png';

export default (text: string) => {
  let replaced = text;

  // BREAK
  replaced = replaced.replace(/{BREAK}/g, '<br />');
  // BOLD
  replaced = replaced.replace(/{BOLD}(.*?){END}/g, `<span style='font-weight: bold'>$1</span>`);
  // ELITE
  replaced = replaced.replace(
    /{ELITE}(.*?){END}/g,
    `<span style='color: ${ELITE_RED}; font-weight: bold'>$1</span>`
  );
  // ACTION IMAGE
  replaced = replaced.replace(
    /{ACTION}/g,
    `<img alt="Action" src='${actionPng}' style='height: 24px; width: 26px; vertical-align: middle' />`
  );
  // SURGE IMAGE
  replaced = replaced.replace(
    /{SURGE}/g,
    `<img alt="Surge" src='${surgePng}' style='height: 24px; width: 25px; vertical-align: middle' />`
  );
  // STRAIN IMAGE
  replaced = replaced.replace(
    /{STRAIN}/g,
    `<img alt="Strain" src='${strainPng}' style='height: 24px; width: 18px; vertical-align: middle' />`
  );
  // BLOCK IMAGE
  replaced = replaced.replace(
    /{BLOCK}/g,
    `<img alt="Block" src='${blockPng}' style='height: 20px; width: 18px; vertical-align: middle' />`
  );
  // DAMAGE IMAGE
  replaced = replaced.replace(
    /{DAMAGE}/g,
    `<img alt="Damage" src='${damagePng}' style='height: 24px; width: 20px; vertical-align: middle' />`
  );
  // MELEE IMAGE
  replaced = replaced.replace(
    /{MELEE}/g,
    `<img alt="Melee" src='${meleePng}' style='height: 24px; width: 11px; vertical-align: middle' />`
  );
  // STRENGTH IMAGE
  replaced = replaced.replace(
    /{STRENGTH}/g,
    `<img alt="Strength" src='${strengthPng}' style='height: 24px; width: 18px; vertical-align: middle' />`
  );
  // INSIGHT IMAGE
  replaced = replaced.replace(
    /{INSIGHT}/g,
    `<img alt="Insight" src='${insightPng}' style='height: 24px; width: 20px; vertical-align: middle' />`
  );
  // TECH IMAGE
  replaced = replaced.replace(
    /{TECH}/g,
    `<img alt="Tech" src='${techPng}' style='height: 24px; width: 18px; vertical-align: middle' />`
  );

  return replaced;
};
