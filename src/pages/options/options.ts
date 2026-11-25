import { storage } from '../../platform/storage';
import { byId } from '../shared/dom';
import { createDeferredRenderer } from '../shared/storage-sync';
import { renderConnection } from './connection';
import { renderGeneral } from './general';
import { renderRepos } from './repos';
import { renderRules } from './rules';

const connectionEl = byId('connection');
const rulesEl = byId('rules');
const reposEl = byId('repos');
const generalEl = byId('general');

const scheduleConnection = createDeferredRenderer(connectionEl, () => renderConnection(connectionEl));
const scheduleRules = createDeferredRenderer(rulesEl, () => renderRules(rulesEl));
const scheduleRepos = createDeferredRenderer(reposEl, () => renderRepos(reposEl));
const scheduleGeneral = createDeferredRenderer(generalEl, () => renderGeneral(generalEl));

storage.onChanged((changes) => {
  if (changes.settings) {
    scheduleConnection();
    scheduleGeneral();
  }

  if (changes.auth || changes.me || changes.authError) scheduleConnection();
  if (changes.rules) scheduleRules();
  if (changes.repos) scheduleRepos();
});

void Promise.all([
  renderConnection(connectionEl),
  renderRules(rulesEl),
  renderRepos(reposEl),
  renderGeneral(generalEl),
]);
