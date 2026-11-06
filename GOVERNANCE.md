# Governance

CAP is an open specification. Anyone can implement it without asking permission, paying a fee, or using a particular vendor.

## Status

Version 1.0 is a **draft**. The wire format is `/cap/v1`, `CAP-Version: 1.0`, and `Protocol: CAP/1.0`.

While the spec is a draft:

- Breaking changes are allowed. Each one is listed in [CHANGELOG.md](CHANGELOG.md) with what an owner or a caller has to change.
- The version stays 1.0. Implementations should expect to update as the draft changes.

Version 1.0 becomes final when several independent owners serve it in production. After that:

- Changes within 1.x only add. An existing owner or caller keeps working without a change.
- A breaking change ships as a new version on a new path, `/cap/v2`. Owners may serve both.

## Making a change

1. Open an issue that describes the problem before proposing wording.
2. Open a pull request that changes `spec.md` and the reference server together. From `reference/`, `node check.mjs` must pass.
3. Sign off each commit (`git commit -s`) under the [Developer Certificate of Origin](https://developercertificate.org).
4. A maintainer merges after at least one week of public review for any change to the wire format.

Editorial fixes, such as typos and clearer wording with the same meaning, can merge without the review period.

## Maintainers

Maintainers review and merge pull requests and publish releases. They are listed as owners of the [conciergeprotocol](https://github.com/conciergeprotocol) organization on GitHub. A contributor who has helped shape the spec over time can be invited as a maintainer.

Maintainers decide by rough consensus in the issue or pull request. When consensus is not reached, the maintainers decide and record the reason in the thread.

## Stewardship

Tony Spiro is the steward of CAP. He holds the copyright in the original specification and the CAP trademarks, and appoints maintainers. Maintainers do not acquire ownership of the name or the project by being added to the GitHub organization. See [TRADEMARKS.md](TRADEMARKS.md).

## Foundation

That holding is temporary. When three organizations independent of Cosmic serve CAP in production, or when version 1.0 becomes final, whichever comes first, the specification, the reference code, and the CAP trademarks will be transferred to a neutral foundation.

The intended home is the [Agentic AI Foundation](https://aaif.io/projects) at the Linux Foundation, which already stewards the Model Context Protocol and AGENTS.md. If that home is not available, another neutral foundation will be named on this page before the transfer.

The transfer covers the name and the stewardship. The licenses stay as they are: the specification under CC BY 4.0, and the code under Apache 2.0.

## Licenses

- The specification text and documentation are licensed under [CC BY 4.0](LICENSE-SPEC).
- The reference server, examples, and other code are licensed under [Apache 2.0](LICENSE).
- The CAP name and logo are not covered by these licenses. See [TRADEMARKS.md](TRADEMARKS.md).
