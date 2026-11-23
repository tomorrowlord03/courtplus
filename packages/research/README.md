# CourtPlus research

The Node package runs local section suggestion, precedent search, rhetorical-role classification and extractive summarisation.

```ts
import { createResearch } from '@courtplus/research';

const research = createResearch({ modelDir: 'path/to/oldcases-models' });
const sections = await research.suggestSections(facts);
const precedents = await research.searchPrecedents(query, 5);
const roles = await research.classifyRoles(judgmentSentences);
const summary = await research.summarise(judgmentText);
```

The four functions are also available as named exports. They resolve `COURTPLUS_OLDCASES_MODELS` or use `resources/models/oldcases` relative to the packaged app. An explicit `modelDir` takes precedence. The caller can select int8 section inference with `quantizedSections: true`. Nonempty requests require the corresponding local artifact directories. Empty inputs return empty lists.

Render `hintLabel` alongside the source and the suggestion, and require human confirmation before using a result. Summary offsets are UTF-16 character offsets into the supplied judgment. Section scores are sigmoid values, and the API returns the five highest scores. `aboveThreshold` uses the label's dev threshold when the manifest supplies it and the global threshold otherwise. Call `classifyRoles` with the ordered sentences of one judgment so a contextual model can use the neighbors of each sentence. The precedent score is reciprocal rank fusion. It also returns the component BM25 and cosine scores.

Run fixtures with `npm test -w @courtplus/research`. Set `COURTPLUS_OLDCASES_MODELS` to exercise installed models. The training and export commands are in the [model card](../../ml/oldcases/MODEL_CARD.md).
