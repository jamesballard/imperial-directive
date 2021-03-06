// @flow

import {
  ACTIVATE_IMPERIAL_GROUP,
  clearCustomAI,
  DEFEAT_IMPERIAL_FIGURE,
  defeatImperialFigure,
  getLastDeployedGroupOfId,
  setCustomAI,
  setCustomUnitAI,
  setImperialGroupUnactivated,
  setImperialUnitHpBuff,
  silentSetImperialGroupActivated,
} from '../imperials';
import {all, call, fork, put, select, take} from 'redux-saga/effects';
import {getAreAllHeroesWounded, getIsOneHeroLeft, WOUND_REBEL_HERO} from '../rebels';
import {
  getCurrentRound,
  getCurrentThreat,
  increaseThreat,
  MISSION_SPECIAL_SETUP,
  missionSpecialSetupDone,
  SET_MAP_STATE_ACTIVATED,
  setAttackTarget,
  setDeploymentPoint,
  setMapStateVisible,
  setMoveTarget,
  STATUS_PHASE_END_ROUND_EFFECTS,
  statusPhaseEndRoundEffectsDone,
  updateRebelVictory,
} from '../mission';
import {REFER_CAMPAIGN_GUIDE, TARGET_HERO_CLOSEST_UNWOUNDED, TARGET_REMAINING} from './constants';
import createAction from '../createAction';
import {displayModal} from '../modal';
import getRandomItem from '../utils/getRandomItem';
import handleStatusPhaseBegin from './sharedSagas/handleStatusPhaseBegin';
import helperChoiceModal from './helpers/helperChoiceModal';
import helperDeploy from './helpers/helperDeploy';
import helperEventModal from './helpers/helperEventModal';
import helperInitialSetup from './helpers/helperInitialSetup';
import helperMissionBriefing from './helpers/helperMissionBriefing';
import helperShowInterruptedGroup from './helpers/helperShowInterruptedGroup';
import {missionSagaLoadDone} from '../app';
import type {StateType} from '../types';
import track from '../../lib/track';

// Constants

const TARGET_WEISS = 'Weiss';
const TARGET_GENERAL_WEISS = 'General Weiss';

const DEPLOYMENT_POINT_GREEN_WEST = 'The western green deployment point';
const DEPLOYMENT_POINT_GREEN_SOUTH = 'The southern green deployment point';

const CUSTOM_AI_TERMINAL = [
  {
    command:
      '{ACTION} Move to be adjacent to the terminal and {ACTION} Interact with the terminal.',
    condition:
      'If within distance to a terminal or adjacent to a terminal (and one has not been activated this round)',
  },
];

const CUSTOM_AI_WEISS_BEHIND_DOOR = [
  {
    command: '{ACTION} Stay put and hide behind the door.',
    condition: 'If the door out of the Operations Room has not yet been opened',
  },
];

const CUSTOM_AI_WEISS_GO_TO_ATST = [
  {
    command:
      '{ACTION} Move until adjacent to the door, then {ACTION} Open the door, then {ACTION} Move towards General Weiss.',
    condition: 'If the door to the Operation Room is still closed',
  },
  {
    command:
      '{ACTION} Move until adjacent to General Weiss, then {ACTION} Move until adjacent to General Weiss, then {ACTION} Interact with General Weiss to enter the {ELITE}ATST{END}.',
    condition: 'If General Weiss is deployed',
  },
];

const CUSTOM_AI_WEISS_REGULAR_BEHAVIOR = [
  {
    command:
      '{ACTION} Use Executive Order ability on that friendly figure to have it attack {ATTACK_TARGET}.',
    condition:
      'If within 2 spaces of a friendly target that is within attack range and LOS of {ATTACK_TARGET}',
  },
  {
    command:
      '{ACTION} Move to be within 4 spaces and LOS of {ATTACK_TARGET}, then {ACTION} Attack {ATTACK_TARGET}, then {ACTION} Move adjacent to the most friendly figures.',
    condition: 'If within 6 spaces and in LOS of {ATTACK_TARGET}',
  },
  {
    command: 'Use Cower ability if a rolled dice does not cancel anything.',
    condition: 'Reaction - If defending while adjacent to a friendly figure',
  },
];

const CUSTOM_AI_EXCLUSION_LIST = ['nexu', 'nexuElite', 'weiss', 'generalWeiss'];

// Types

export type ChainOfCommandStateType = {
  generalWeissActive: boolean,
  generalWeissDeployed: boolean,
  priorityTargetKillHero: boolean,
  terminalActivatedForRound: boolean,
};

// State

const initialState = {
  generalWeissActive: false,
  generalWeissDeployed: false,
  priorityTargetKillHero: false,
  terminalActivatedForRound: false,
};

export default (state: ChainOfCommandStateType = initialState, action: Object) => {
  switch (action.type) {
    case 'CHAIN_OF_COMMAND_SET_GENERAL_WEISS_ACTIVE':
      return {
        ...state,
        generalWeissActive: action.payload,
      };
    case 'CHAIN_OF_COMMAND_SET_GENERAL_WEISS_DEPLOYED':
      return {
        ...state,
        generalWeissDeployed: action.payload,
      };
    case 'CHAIN_OF_COMMAND_PRIORITY_TARGET_KILL_HERO':
      return {
        ...state,
        priorityTargetKillHero: action.payload,
      };
    case 'CHAIN_OF_COMMAND_TERMINAL_INTERACT':
      return {
        ...state,
        terminalActivatedForRound: true,
      };
    // Use this as a proxy for a new round starting so the Imperial troops can re-activate
    case STATUS_PHASE_END_ROUND_EFFECTS:
      return {
        ...state,
        terminalActivatedForRound: false,
      };
    default:
      return state;
  }
};

// Selectors

const getState = (state: StateType) => state.chainOfCommand;
export const getChainOfCommandGoalText = (state: StateType): string[] => {
  let goals = [];

  if (!state.chainOfCommand.generalWeissActive) {
    goals = goals.concat([
      '{BOLD}Door:{END}',
      'Locked to heroes. A hero can interact (2 {STRENGTH} or {TECH}) to open it.',
      '{BREAK}',
      '{BOLD}Weiss:{END}',
      'Gains +6 Health, +1 Speed, +2 {DAMAGE} to attack, and +1 {BLOCK} to defense',
      '{BREAK}',
    ]);
  }

  goals = goals.concat([
    '{BOLD}Terminals:{END}',
    'A Rebel hero can attack a terminal to destroy it (Health: 8, Defense: 1 {BLOCK}).',
    '{BREAK}',
    'An Imperial figure can interact to increase the threat by 2. Each terminal can be used {BOLD}once per round{END}.',
  ]);

  return goals;
};

// Sagas

function getRandomDeploymentPoint() {
  return getRandomItem(DEPLOYMENT_POINT_GREEN_WEST, DEPLOYMENT_POINT_GREEN_SOUTH);
}

function* handleWeissDoorOpened(): Generator<*, *, *> {
  while (true) {
    const action = yield take(SET_MAP_STATE_ACTIVATED);
    const {id, type, value} = action.payload;
    if (id === 1 && type === 'door' && value === true) {
      // If the door opens before the ATST is deployed, then use regular commands
      // Otherwise if Weiss moves it
      const {generalWeissDeployed} = yield select(getState);
      if (generalWeissDeployed) {
        yield put(setCustomUnitAI('weiss', CUSTOM_AI_WEISS_GO_TO_ATST));
      } else {
        yield put(setCustomUnitAI('weiss', CUSTOM_AI_WEISS_REGULAR_BEHAVIOR));
      }
      // We're done
      break;
    }
  }
}

function* handleVulnerableEvent(): Generator<*, *, *> {
  track('chainOfCommand', 'vulnerable', 'triggered');
  yield call(
    helperDeploy,
    'Vulnerable',
    REFER_CAMPAIGN_GUIDE,
    [
      'Deploy {ELITE}General Weiss{END} to the red points, touching the base with all points.',
      '{ELITE}General Weiss{END} cannot activate but can still be attacked.',
      '{ELITE}Weiss{END} can interact with the AT-ST to enter it.',
    ],
    ['generalWeiss', 'Deploy to the red points, touching the base with all points.']
  );
  const answer = yield call(
    helperChoiceModal,
    'Has {ELITE}Weiss{END} taken any damage?',
    'Vulnerable'
  );
  if (answer === 'yes') {
    yield call(helperEventModal, {
      text: [
        '{ELITE}Weiss{END} recovers up to 5 {DAMAGE} and gains 3 movement points.',
        'Move {ELITE}Weiss{END} closer to the AT-ST.',
      ],
      title: 'Vulnerable',
    });
  } else {
    yield call(helperEventModal, {
      text: [
        '{ELITE}Weiss{END} interrupts to perform 2 attacks.',
        'His AI card will now be displayed.',
      ],
      title: 'Vulnerable',
    });
    yield call(helperShowInterruptedGroup, 'weiss');
  }
  // Need to set General Weiss as activated so he doesn't take his turn
  const generalWeissGroup = yield select(getLastDeployedGroupOfId, 'generalWeiss');
  yield put(silentSetImperialGroupActivated(generalWeissGroup));
  yield put(createAction('CHAIN_OF_COMMAND_SET_GENERAL_WEISS_DEPLOYED', true));
  // Weiss needs to move now
  yield put(setCustomUnitAI('weiss', CUSTOM_AI_WEISS_GO_TO_ATST));
}

function* handleWeissDefeated(): Generator<*, *, *> {
  while (true) {
    const action = yield take(DEFEAT_IMPERIAL_FIGURE);
    const {group} = action.payload;
    const {generalWeissActive, generalWeissDeployed} = yield select(getState);
    if (
      (!generalWeissActive && group.id === 'weiss') ||
      (generalWeissActive && group.id === 'generalWeiss')
    ) {
      yield put(displayModal('REBEL_VICTORY'));
      track('chainOfCommand', 'victory', group.id);
      break;
    } else if (!generalWeissActive && generalWeissDeployed && group.id === 'generalWeiss') {
      // If the ATST was deployed but defeated, revert Weiss back to regular unit since he
      // has no ATST to enter anymore
      yield put(setCustomUnitAI('weiss', CUSTOM_AI_WEISS_REGULAR_BEHAVIOR));
    }
  }
}

function* handleWeissEntersATST(): Generator<*, *, *> {
  yield take('CHAIN_OF_COMMAND_WEISS_ENTERED');

  track('chainOfCommand', 'invulnerable', 'triggered');

  // Need to remove Weiss and make General Weiss active
  yield put(createAction('CHAIN_OF_COMMAND_SET_GENERAL_WEISS_ACTIVE', true));
  // Defeat the old one since it's fine now since it won't trigger end game
  const weissGroup = yield select(getLastDeployedGroupOfId, 'weiss');
  yield put(defeatImperialFigure(weissGroup, false));

  yield call(helperEventModal, {
    text: [
      'Remove {ELITE}Weiss{END} from the game along with his deployment card.',
      '{ELITE}General Weiss{END} recovers 5 {DAMAGE} and gains 3 movement points.',
      'If any Rebel figures with only {MELEE} attacks are adjacent to {ELITE}General Weiss{END}, use those points to move away from them.',
      'Otherwise, use those points to move within 4 spaces of the nearest hero.',
      '{ELITE}General Weiss{END} now activates as normal. He cannot exit the hanger.',
    ],
    title: 'Invulnerable',
  });

  // Unexhaust General Weiss
  const generalWeissGroup = yield select(getLastDeployedGroupOfId, 'generalWeiss');
  yield put(setImperialGroupUnactivated(generalWeissGroup));

  // Update victory
  yield put(updateRebelVictory('When General Weiss is defeated'));

  // Switch target
  yield put(setMoveTarget(TARGET_GENERAL_WEISS));
}

function* handleGeneralWeissDefends(): Generator<*, *, *> {
  while (true) {
    yield take('CHAIN_OF_COMMAND_WEISS_DEFENDS');

    const currentThreat = yield select(getCurrentThreat);
    if (currentThreat < 2) {
      yield call(helperEventModal, {
        text: ['There is not enough threat for {ELITE}General Weiss{END} to utilize.'],
        title: 'General Weiss',
      });
    } else {
      yield call(helperEventModal, {
        text: ['Two threat was used to give {ELITE}General Weiss{END} +3 {BLOCK} when defending.'],
        title: 'General Weiss',
      });
      yield put(increaseThreat(-2));
    }
  }
}

function* handleGeneralWeissActivation(): Generator<*, *, *> {
  while (true) {
    const action = yield take(ACTIVATE_IMPERIAL_GROUP);
    const {group} = action.payload;
    if (group.id === 'generalWeiss') {
      const currentThreat = yield select(getCurrentThreat);
      if (currentThreat < 2) {
        return;
      }

      const answer = yield call(
        helperChoiceModal,
        `Has General Weiss taken at least 4 {DAMAGE}?`,
        'General Weiss'
      );
      if (answer === 'yes') {
        yield call(helperEventModal, {
          text: ['Two threat was used to heal {ELITE}General Weiss{END} for 5 {DAMAGE}.'],
          title: 'General Weiss',
        });
        yield put(increaseThreat(-2));
      }
    }
  }
}

function* handleTerminalDestroyed(): Generator<*, *, *> {
  while (true) {
    const action = yield take(SET_MAP_STATE_ACTIVATED);
    const {id, type, value} = action.payload;
    if (type === 'terminal' && value === true) {
      yield put(setMapStateVisible(id, 'terminal', false));
    }
  }
}

function* handleTerminalInteracted(): Generator<*, *, *> {
  while (true) {
    yield take('CHAIN_OF_COMMAND_TERMINAL_INTERACT');
    yield put(clearCustomAI());
    yield call(helperEventModal, {
      text: ['The threat has been increased by 2.'],
      title: 'Chain of Command',
    });
    yield put(increaseThreat(2));
  }
}

function* handleHeroesWounded(): Generator<*, *, *> {
  while (true) {
    yield take(WOUND_REBEL_HERO);
    const allWounded = yield select(getAreAllHeroesWounded);
    if (allWounded) {
      // End game with imperial victory
      yield put(displayModal('IMPERIAL_VICTORY'));
      track('chainOfCommand', 'defeat', 'wounded');
      break;
    }
    const isOneHeroLeft = yield select(getIsOneHeroLeft);
    if (isOneHeroLeft) {
      // Switch targets
      yield put(createAction('CHAIN_OF_COMMAND_PRIORITY_TARGET_KILL_HERO', true));
      yield put(setAttackTarget(TARGET_REMAINING));
      yield put(setMoveTarget(TARGET_REMAINING));
    }
  }
}

// REQUIRED SAGA
function* handleRoundEnd(): Generator<*, *, *> {
  while (true) {
    yield take(STATUS_PHASE_END_ROUND_EFFECTS);
    const currentRound = yield select(getCurrentRound);

    if (currentRound === 2) {
      yield call(handleVulnerableEvent);
    }

    // If General Weiss is deployed but not yet active, make sure to exhaust him so he doesn't
    // get a turn
    const {generalWeissActive, generalWeissDeployed} = yield select(getState);
    if (generalWeissDeployed && !generalWeissActive) {
      const generalWeissGroup = yield select(getLastDeployedGroupOfId, 'generalWeiss');
      yield put(silentSetImperialGroupActivated(generalWeissGroup));
    }

    // Reset Custom AI in case it was cleared
    yield put(setCustomAI(CUSTOM_AI_TERMINAL, CUSTOM_AI_EXCLUSION_LIST));

    // Change deployment point to a random one at the end of each round
    yield put(setDeploymentPoint(getRandomDeploymentPoint()));

    yield put(statusPhaseEndRoundEffectsDone());
  }
}

// REQUIRED SAGA
function* handleSpecialSetup(): Generator<*, *, *> {
  yield take(MISSION_SPECIAL_SETUP);
  yield call(helperEventModal, {
    text: [
      'Initial deployment of troops will now occur.',
      'When deploying {ELITE}Weiss{END}, deploy an {ELITE}Elite Imperial Officer{END}.',
    ],
    title: 'Initial Setup',
  });
  yield call(helperInitialSetup, [
    'imperialOfficer',
    'weiss',
    'probeDroid',
    'royalGuard',
    'stormtrooper',
    'stormtrooperElite',
  ]);
  yield call(helperMissionBriefing, [
    'The {ELITE}Elite Imperial Officer{END} is {ELITE}Weiss{END}. He has +6 Health and +1 Speed. He gets +2 {DAMAGE} to attack and +1 {BLOCK} to defense.',
    'An Imperial figure can interact with a terminal to increase threat by 2 once per round.',
    'The door is locked to heroes. A hero can interact with it (2 {STRENGTH} or {TECH}) to open it.',
    'A Rebel figure can attack a terminal (Health: 8, Defense: 1 {BLOCK}) to destroy it.',
  ]);
  yield put(setImperialUnitHpBuff('weiss', 6));
  yield put(missionSpecialSetupDone());
}

/*
Priority target definitions:
1) Initial attack is default, move is Weiss
2) At end of round 2, move is General Weiss
3) At any point if heroes - 1 are wounded, attack and move are the last remaining hero
*/
export function* chainOfCommand(): Generator<*, *, *> {
  // SET TARGETS
  yield put(setAttackTarget(TARGET_HERO_CLOSEST_UNWOUNDED));
  yield put(setMoveTarget(TARGET_WEISS));
  // SET INITIAL DEPLOYMENT POINT
  yield put(setDeploymentPoint(getRandomDeploymentPoint()));

  // Set custom AI
  yield put(setCustomAI(CUSTOM_AI_TERMINAL, CUSTOM_AI_EXCLUSION_LIST));

  // Set initial AI for Weiss
  yield put(setCustomUnitAI('weiss', CUSTOM_AI_WEISS_BEHIND_DOOR));

  yield all([
    fork(handleSpecialSetup),
    fork(handleWeissDoorOpened),
    fork(handleWeissDefeated),
    fork(handleWeissEntersATST),
    fork(handleGeneralWeissDefends),
    fork(handleGeneralWeissActivation),
    fork(handleTerminalDestroyed),
    fork(handleTerminalInteracted),
    fork(handleHeroesWounded),
    fork(handleStatusPhaseBegin),
    fork(handleRoundEnd),
  ]);

  track('missionStart', 'chainOfCommand');
  yield put(missionSagaLoadDone());
}
