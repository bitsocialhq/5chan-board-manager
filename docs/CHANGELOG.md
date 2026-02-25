# Changelog

## [0.1.6](https://github.com/bitsocialhq/5chan-board-manager/compare/v0.1.5...v0.1.6) (2026-02-25)

### Bug Fixes

* **docker:** include preset files in Docker image ([7c6a559](https://github.com/bitsocialhq/5chan-board-manager/commit/7c6a559188e510c826030a651cda42e839506af1))

## [0.1.5](https://github.com/bitsocialhq/5chan-board-manager/compare/v0.1.4...v0.1.5) (2026-02-25)

### Features

* add configurable userAgent to Plebbit RPC connection ([15c0a7e](https://github.com/bitsocialhq/5chan-board-manager/commit/15c0a7e81d7cb3414284c66851c123828ca23e95))

### Bug Fixes

* **ci:** pass RPC auth key for cross-container connections ([0a53751](https://github.com/bitsocialhq/5chan-board-manager/commit/0a53751ac31ce234a5e601e32718ad6dc08619c0))

## [0.1.4](https://github.com/bitsocialhq/5chan-board-manager/compare/v0.1.3...v0.1.4) (2026-02-23)

### Bug Fixes

* **ci:** use quiet flag when extracting community address ([c409dfb](https://github.com/bitsocialhq/5chan-board-manager/commit/c409dfb63394fecc6fc10c5f2dc58a2d9cfbcac9))

## [0.1.3](https://github.com/bitsocialhq/5chan-board-manager/compare/v0.1.2...v0.1.3) (2026-02-23)

### Bug Fixes

* **ci:** add packages:read permission for GHCR pulls ([a5fa4a6](https://github.com/bitsocialhq/5chan-board-manager/commit/a5fa4a607a8243e8f7a9a4e4c6834b536c900651))

## [0.1.2](https://github.com/bitsocialhq/5chan-board-manager/compare/v0.1.1...v0.1.2) (2026-02-23)

### Bug Fixes

* **ci:** add GHCR authentication to Docker Compose CI workflow ([610e237](https://github.com/bitsocialhq/5chan-board-manager/commit/610e23770d6a544f3a3d2e3dca553c7cbd6565b9))
* **ci:** trigger CI workflow on any .github/ changes ([e099498](https://github.com/bitsocialhq/5chan-board-manager/commit/e099498c25cf04cdddfb6ced4144fe06fea01763))

## 0.1.1 (2026-02-23)

### Features

* add `board edit` command with hot-reload restart ([c93ef29](https://github.com/bitsocialhq/5chan-board-manager/commit/c93ef2995c46d5107361fa31ecc9e6b54402c2db))
* **board:** add interactive defaults review with $EDITOR modify support ([17876da](https://github.com/bitsocialhq/5chan-board-manager/commit/17876dabb42da812aabb9e578f50dd65823e44af))
* **board:** apply preset defaults on board add ([aaeb8b6](https://github.com/bitsocialhq/5chan-board-manager/commit/aaeb8b6ed391eb2a43c25ef0f584d9331d1e4296))
* **board:** reject unknown flags with helpful error in add/edit commands ([bd91098](https://github.com/bitsocialhq/5chan-board-manager/commit/bd9109839238adbdb4ea9c22476a992332429fb1))
* **board:** simplify `board list` to addresses-only and add `board edit --interactive` ([c6df72e](https://github.com/bitsocialhq/5chan-board-manager/commit/c6df72ecca905eecf0c51f1586805854c31bce3a))
* **ci:** add Docker Compose integration tests that gate image publish ([8b8ad7b](https://github.com/bitsocialhq/5chan-board-manager/commit/8b8ad7ba3e99270e34c46de919d6bcc8962b97d5))
* **docker:** enable DEBUG logging by default in Docker image ([6c6408f](https://github.com/bitsocialhq/5chan-board-manager/commit/6c6408fe00b6610e9a1a547cf24843e73e7c5a93))
* handle board address changes automatically ([3235f90](https://github.com/bitsocialhq/5chan-board-manager/commit/3235f906b10c752ffde73a299ca5290be34faf59))
* **moderation:** add configurable reason strings for archive and purge ([797bc2b](https://github.com/bitsocialhq/5chan-board-manager/commit/797bc2bfe54fe2c56996e063295616e3453204c3))
* **preset:** add JSONC comments to preset file for interactive editing ([0336ff4](https://github.com/bitsocialhq/5chan-board-manager/commit/0336ff48652b697e72ae54b7d71d7571e3df20d4))

### Bug Fixes

* **board:** check for duplicate board before preset defaults flow ([bf4a4a1](https://github.com/bitsocialhq/5chan-board-manager/commit/bf4a4a12d5140d76627d053cc7733d002058631e))
* handle trailing commas in JSONC community defaults preset ([0704d8b](https://github.com/bitsocialhq/5chan-board-manager/commit/0704d8b24e8ad09e1bcd406365cc3db9c82ffc28))
* pin @oclif/core and @oclif/plugin-help to exact versions ([be3454e](https://github.com/bitsocialhq/5chan-board-manager/commit/be3454e193c820bf5d70c88456b4e5e486d30e54))
* **preset:** force JSON syntax highlighting when nano opens JSONC preset ([58fd70a](https://github.com/bitsocialhq/5chan-board-manager/commit/58fd70ac1793b825200ab1674590adb9c0503539))
* **tests:** make tests cross-platform for Windows CI ([c638668](https://github.com/bitsocialhq/5chan-board-manager/commit/c6386682e2a9a3fe3f56c65443c2a2a2fa5ac053))
* throw on startup when all boards fail in archiver manager ([93838a0](https://github.com/bitsocialhq/5chan-board-manager/commit/93838a0954e77a1bedfdca0de66252a0f266db6f))
* wait for subplebbitschange before accessing plebbit.subplebbits ([a868fb3](https://github.com/bitsocialhq/5chan-board-manager/commit/a868fb333d0486a336c436eccb51a0468090ed8c))

### Build System

* add conventional commits, commitlint, husky, and release-it ([eff956f](https://github.com/bitsocialhq/5chan-board-manager/commit/eff956fb39913ce1b4d18acc24378e69405c0aa1))
* add Docker image and CI release pipeline ([ea7a1ec](https://github.com/bitsocialhq/5chan-board-manager/commit/ea7a1ec532f08fed94df4ca31e8e2e706d3e895d))
* auto-generate CLI command docs from oclif ([a1f05ee](https://github.com/bitsocialhq/5chan-board-manager/commit/a1f05ee3c7b85056cc72cdad17ce2e76873a2055))
* **deps:** set deps to specific versions ([1122d2a](https://github.com/bitsocialhq/5chan-board-manager/commit/1122d2a7cf4b397fa9ee319b46d74ac118349ac3))
