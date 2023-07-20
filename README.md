# NFT Lending Contracts

<img alt="Solidity" src="https://img.shields.io/badge/Solidity-e6e6e6?style=for-the-badge&logo=solidity&logoColor=black" /> <img alt="Solidity" src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" />

## Overview

This repository contains the solidity smart contracts for nft-lending

## Prerequisites

-   git
-   node | npm

## Getting started

-   Clone the repository

```
git clone https://github.com/nonceblox/voxies-contracts
```

-   Navigate to `voxies-contracts` directory

```
cd voxies-contracts
```

-   Install dependencies

```
npm i
```

### Configure project

**Environment Configuration**

-   Copy `.example.env` to `.env`

```
cp .example.env .env
```

## Run tasks

-   test

```sh
npm test
```

### Deploy to Testnet

```sh
npx hardhat run --network <your-network> scripts/<deployment-file>
```

## Verify smart contracts

```sh
npx hardhat verify --network <network-name-in-hardhat-config> DEPLOYED_CONTRACT_ADDRESS "Constructor arguments"
```
