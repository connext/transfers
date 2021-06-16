/* eslint-disable @typescript-eslint/no-empty-function */
import {
  Balance,
  CrosschainTransferState,
  CrosschainTransferResolver,
} from "@connext/vector-types";
import {
  getRandomAddress,
  getRandomBytes32,
  keyify,
  expect,
  encodeTransferResolver,
  encodeTransferState,
  encodeBalance,
  mkSig,
  ChannelSigner,
} from "@connext/vector-utils";
import { AddressZero, HashZero, Zero } from "@ethersproject/constants";
import { Wallet } from "ethers";
import { ethers } from "hardhat";
import { CrosschainTransfer } from "../../typechain";

const { utils, BigNumber } = ethers;

describe("CrosschainTransfer", () => {
  const provider = ethers.provider;

  let initiator: ChannelSigner;
  let responder: ChannelSigner;

  let transfer: CrosschainTransfer;
  let CrosschainTransferStateEncoding: string;
  let CrosschainTransferResolverEncoding: string;

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    initiator = new ChannelSigner(Wallet.createRandom().privateKey);
    responder = new ChannelSigner(Wallet.createRandom().privateKey);

    const factory = await ethers.getContractFactory(
      "CrosschainTransfer",
      signers[0]
    );
    const deployed = await factory.deploy();
    transfer = (await deployed.deployed()) as CrosschainTransfer;

    const registry = await transfer.getRegistryInformation();
    CrosschainTransferStateEncoding = registry.stateEncoding;
    CrosschainTransferResolverEncoding = registry.resolverEncoding;
  });

  const createLockHash = (preImage: string): string =>
    utils.soliditySha256(["bytes32"], [preImage]);

  const createRandomInitialState = async (
    overrides: {
      state?: Partial<CrosschainTransferState>;
      balance?: Partial<Balance>;
    } = { balance: {}, state: {} }
  ) => createInitialState(getRandomBytes32(), getRandomBytes32(), overrides);

  const createInitialState = async (
    data: string,
    preImage: string,
    overrides: {
      state?: Partial<CrosschainTransferState>;
      balance?: Partial<Balance>;
    } = { balance: {}, state: {} }
  ): Promise<{ state: CrosschainTransferState; balance: Balance }> => {
    const senderAddr = getRandomAddress();
    const receiverAddr = getRandomAddress();
    const transferAmount = "10000";
    const lockHash = createLockHash(preImage);
    return {
      balance: {
        amount: [transferAmount, Zero.toString()],
        to: [senderAddr, receiverAddr],
        ...(overrides.balance ?? {}),
      },
      state: {
        lockHash,
        initiatorSignature: await initiator.signMessage(data),
        initiator: senderAddr,
        responder: receiverAddr,
        data,
        nonce: getRandomBytes32(),
        fee: "0",
        callData: "0x",
        callTo: AddressZero,
        ...(overrides.state ?? {}),
      },
    };
  };

  const createResolver = async (
    overrides: Partial<CrosschainTransferResolver> = {}
  ): Promise<CrosschainTransferResolver> => {
    return {
      responderSignature: await responder.signMessage(getRandomBytes32()),
      preImage: getRandomBytes32(),
      ...overrides,
    };
  };

  const createTransfer = async (
    balance: Balance,
    initialState: CrosschainTransferState
  ): Promise<boolean> => {
    const encodedState = encodeTransferState(
      initialState,
      CrosschainTransferStateEncoding
    );
    const encodedBalance = encodeBalance(balance);
    return transfer.create(encodedBalance, encodedState);
  };

  const resolveTransfer = async (
    balance: Balance,
    initialState: CrosschainTransferState,
    resolver: CrosschainTransferResolver
  ): Promise<Balance> => {
    const encodedState = encodeTransferState(
      initialState,
      CrosschainTransferStateEncoding
    );
    const encodedResolver = encodeTransferResolver(
      resolver,
      CrosschainTransferResolverEncoding
    );
    const encodedBalance = encodeBalance(balance);
    const res = await transfer.resolve(
      encodedBalance,
      encodedState,
      encodedResolver
    );
    return keyify(balance, res);
  };

  const validateResult = async (
    balance: Balance,
    initialState: CrosschainTransferState,
    resolver: CrosschainTransferResolver,
    result: Balance
  ): Promise<void> => {
    if (
      resolver.preImage !== HashZero &&
      (initialState.expiry === "0" ||
        BigNumber.from(initialState.expiry).gt(await provider.getBlockNumber()))
    ) {
      // Payment completed
      expect(result.to).to.deep.equal(balance.to);
      expect(result.amount[0].toString()).to.eq("0");
      expect(result.amount[1].toString()).to.eq(balance.amount[0]);
    } else {
      // Payment reverted
      expect(result.to).to.deep.equal(balance.to);
      expect(result.amount[0].toString()).to.eq(balance.amount[0]);
      expect(result.amount[1].toString()).to.eq(balance.amount[1]);
    }
  };

  it("should deploy", async () => {
    expect(transfer.address).to.be.a("string");
  });

  it("should return the registry information", async () => {
    const registry = await transfer.getRegistryInformation();
    expect(registry.name).to.be.eq("CrosschainTransfer");
    expect(registry.stateEncoding).to.be.eq(
      `tuple(
        bytes initiatorSignature,
        address initiator,
        address responder,
        bytes32 data,
        uint256 nonce,
        uint256 fee,
        address callTo,
        bytes callData,
        bytes32 lockHash
      )`
    );
    expect(registry.resolverEncoding).to.be.eq(
      "tuple(bytes responderSignature, bytes32 preImage)"
    );
    expect(registry.definition).to.be.eq(transfer.address);
    expect(registry.encodedCancel).to.be.eq(
      encodeTransferResolver(
        { preImage: HashZero, responderSignature: mkSig("0x0") },
        registry.resolverEncoding
      )
    );
  });

  describe("Create", () => {
    it("should create successfully", async () => {
      const { balance, state } = await createRandomInitialState();
      expect(await createTransfer(balance, state)).to.be.true;
    });

    it("should fail if sender balance is zero", async () => {
      const { balance, state } = await createRandomInitialState();
      balance.amount[0] = "0";
      expect(await createTransfer(balance, state)).revertedWith(
        "CrosschainTransfer: ZER0_SENDER_BALANCE"
      );
    });

    it("should fail if recipient has nonzero balance", async () => {
      const { balance, state } = await createRandomInitialState();
      balance.amount[1] = balance.amount[0];
      expect(await createTransfer(balance, state)).revertedWith(
        "CrosschainTransfer: NONZERO_RECIPIENT_BALANCE"
      );
    });

    it("should fail if lockHash is empty", async () => {
      const { balance, state } = await createRandomInitialState();
      state.lockHash = HashZero;
      expect(await createTransfer(balance, state)).revertedWith(
        "CrosschainTransfer: EMPTY_LOCKHASH"
      );
    });
  });

  describe("Resolve", () => {
    it("should fail if there is no initiatior", async () => {
      const { balance, state } = await createRandomInitialState({
        state: { initiatior: AddressZero },
      });
      expect(
        await resolveTransfer(balance, state, await createResolver())
      ).revertedWith("CrosschainTransfer: EMPTY_SIGNERS");
    });

    it("should fail if there is no responder", async () => {
      const { balance, state } = await createRandomInitialState({
        state: { responder: AddressZero },
      });
      await expect(
        resolveTransfer(balance, state, await createResolver())
      ).revertedWith("CrosschainTransfer: EMPTY_SIGNERS");
    });

    // it("should refund if preimage is HashZero", async () => {
    //   const preImage = getRandomBytes32();
    //   const { state, balance } = await createInitialState(preImage);
    //   const result = await resolveTransfer(balance, state, {
    //     preImage: HashZero,
    //   });
    //   await validateResult(balance, state, { preImage: HashZero }, result);
    // });

    it("should fail if the hash generated does not match preimage", async () => {
      const { balance, state } = await createRandomInitialState();
      const incorrectPreImage = getRandomBytes32();
      await expect(
        resolveTransfer(
          balance,
          state,
          await createResolver({ preImage: incorrectPreImage })
        )
      ).revertedWith("CrosschainTransfer: INVALID_PREIMAGE");
    });
  });
});
