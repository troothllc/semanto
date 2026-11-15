<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Trooth, LLC -->

# Answer vectors, version 1

The answer matcher every library runs in process, and the answers Trooth's service gives with it.

- `matcher.json`: the matcher's data (the order of the steps, the thresholds, the key terms and the key catalog) and
  its id. The id is an FNV-1a hash of that data and equals the `matcher` field of every answer from
  `GET https://api.trooth.co/public/semanto/answer`.
- `answers.json`: a file of facts, the marks in force (one fact the monitor found changed, one past its valid-through
  date), a fixed time, and the service's answer to each question and fact ID. A library passes when its answer to every
  case equals the expected one exactly.

The matcher uses no model: a fact ID, then the record's question map, then the words that name a fact type, then word
overlap with the signed sentence. More than one fact with different values is a list of candidates, and no fact is the
not-published reply, never a nearby fact. A fact with a mark returns the mark and no value.
