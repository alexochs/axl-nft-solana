import React, { useEffect, useState } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { Program, Provider, web3 } from '@project-serum/anchor';
import { MintLayout, TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import { sendTransactions, sleep } from './connection';
import './CandyMachine.css';
import {
  candyMachineProgram,
  TOKEN_METADATA_PROGRAM_ID,
  SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
  getAtaForMint,
  getNetworkExpire,
  getNetworkToken,
  CIVIC
} from './helpers';
import { bs58 } from '@project-serum/anchor/dist/cjs/utils/bytes';
import CountdownTimer from '../CountdownTimer';
import { getFirestore, collection, doc, addDoc, getDocs, updateDoc, setDoc } from 'firebase/firestore';
import { Metadata } from '@metaplex-foundation/mpl-token-metadata';

const MAX_NAME_LENGTH = 32;
const MAX_URI_LENGTH = 200;
const MAX_SYMBOL_LENGTH = 10;
const MAX_CREATOR_LEN = 32 + 1 + 1;
const MAX_CREATOR_LIMIT = 5;
const MAX_DATA_SIZE = 4 + MAX_NAME_LENGTH + 4 + MAX_SYMBOL_LENGTH + 4 + MAX_URI_LENGTH + 2 + 1 + 4 + MAX_CREATOR_LIMIT * MAX_CREATOR_LEN;
const MAX_METADATA_LEN = 1 + 32 + 32 + MAX_DATA_SIZE + 1 + 1 + 9 + 172;
const CREATOR_ARRAY_START = 1 + 32 + 32 + 4 + MAX_NAME_LENGTH + 4 + MAX_URI_LENGTH + 4 + MAX_SYMBOL_LENGTH + 2 + 1 + 4;

const { SystemProgram } = web3;
const opts = {
  preflightCommitment: 'processed',
};

const CandyMachine = ({ walletAddress, firebaseApp}) => {
  const [candyMachine, setCandyMachine] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mints, setMints] = useState([]);
  const [mintExists, setMintExists] = useState(false);
  const [metadatas, setMetadatas] = useState([]);
  const [isOwner, setIsOwner] = useState(false);
  const [ownedMetadata, setOwnedMetadata] = useState(null);
  const [mintButtonText, setMintButtonText] = useState("Mint your NFT");
  const [mintInProgress, setMintInProgress] = useState(false);
  const db = getFirestore(firebaseApp);

  useEffect( () => {
    getCandyMachineState().then(async () => {
      await getData();
      setIsLoading(false);
    });
  }, []);

  const getProvider = () => {
    const rpcHost = process.env.REACT_APP_SOLANA_RPC_HOST;
    // Create a new connection object
    const connection = new Connection(rpcHost);
    
    // Create a new Solana provider object
    const provider = new Provider(
      connection,
      window.solana,
      opts.preflightCommitment
    );
  
    return provider;
  };

  // Declare getCandyMachineState as an async method
  const getCandyMachineState = async () => {
    const provider = getProvider();
    
    // Get metadata about your deployed candy machine program
    const idl = await Program.fetchIdl(candyMachineProgram, provider);

    // Create a program that you can call
    const program = new Program(idl, candyMachineProgram, provider);

    // Fetch the metadata from your candy machine
    const candyMachine = await program.account.candyMachine.fetch(
      process.env.REACT_APP_CANDY_MACHINE_ID
    );
    console.log("✅ Candy Machine");
    console.log(candyMachine);
  
    // Parse out all our metadata and log it out
    const itemsAvailable = candyMachine.data.itemsAvailable.toNumber();
    const itemsRedeemed = candyMachine.itemsRedeemed.toNumber();
    const itemsRemaining = itemsAvailable - itemsRedeemed;
    const goLiveData = candyMachine.data.goLiveDate.toNumber();
    const presale =
      candyMachine.data.whitelistMintSettings &&
      candyMachine.data.whitelistMintSettings.presale &&
      (!candyMachine.data.goLiveDate ||
        candyMachine.data.goLiveDate.toNumber() > new Date().getTime() / 1000);
    
    // We will be using this later in our UI so let's generate this now
    const goLiveDateTimeString = `${new Date(
      goLiveData * 1000
    ).toGMTString()}`

    setCandyMachine({
      id: process.env.REACT_APP_CANDY_MACHINE_ID,
      program,
      state: {
        itemsAvailable,
        itemsRedeemed,
        itemsRemaining,
        goLiveData,
        goLiveDateTimeString,
        isSoldOut: itemsRemaining === 0,
        isActive:
          (presale ||
            candyMachine.data.goLiveDate.toNumber() < new Date().getTime() / 1000) &&
          (candyMachine.endSettings
            ? candyMachine.endSettings.endSettingType.date
              ? candyMachine.endSettings.number.toNumber() > new Date().getTime() / 1000
              : itemsRedeemed < candyMachine.endSettings.number.toNumber()
            : true),
        isPresale: presale,
        goLiveDate: candyMachine.data.goLiveDate,
        treasury: candyMachine.wallet,
        tokenMint: candyMachine.tokenMint,
        gatekeeper: candyMachine.data.gatekeeper,
        endSettings: candyMachine.data.endSettings,
        whitelistMintSettings: candyMachine.data.whitelistMintSettings,
        hiddenSettings: candyMachine.data.hiddenSettings,
        price: candyMachine.data.price,
      },
    });

    if (itemsRedeemed > 0) {
      setMintExists(true);
      //fuckthatshit();
    }
  };

  const getCandyMachineCreator = async (candyMachine) => {
    const candyMachineID = new PublicKey(candyMachine);
    return await web3.PublicKey.findProgramAddress(
        [Buffer.from('candy_machine'), candyMachineID.toBuffer()],
        candyMachineProgram,
    );
  };

  const getMetadata = async (mint) => {
    return (
      await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      )
    )[0];
  };

  const getMasterEdition = async (mint) => {
    return (
      await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
          Buffer.from('edition'),
        ],
        TOKEN_METADATA_PROGRAM_ID
      )
    )[0];
  };
  
  const createAssociatedTokenAccountInstruction = (
    associatedTokenAddress,
    payer,
    walletAddress,
    splTokenMintAddress
  ) => {
    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress, isSigner: false, isWritable: true },
      { pubkey: walletAddress, isSigner: false, isWritable: false },
      { pubkey: splTokenMintAddress, isSigner: false, isWritable: false },
      {
        pubkey: web3.SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      {
        pubkey: web3.SYSVAR_RENT_PUBKEY,
        isSigner: false,
        isWritable: false,
      },
    ];
    return new web3.TransactionInstruction({
      keys,
      programId: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
      data: Buffer.from([]),
    });
  };

  const mintToken = async () => {
    const mint = web3.Keypair.generate();

    const userTokenAccountAddress = (
      await getAtaForMint(mint.publicKey, walletAddress.publicKey)
    )[0];
  
    const userPayingAccountAddress = candyMachine.state.tokenMint
      ? (await getAtaForMint(candyMachine.state.tokenMint, walletAddress.publicKey))[0]
      : walletAddress.publicKey;
  
    const candyMachineAddress = candyMachine.id;
    const remainingAccounts = [];
    const signers = [mint];
    const cleanupInstructions = [];
    const instructions = [
      web3.SystemProgram.createAccount({
        fromPubkey: walletAddress.publicKey,
        newAccountPubkey: mint.publicKey,
        space: MintLayout.span,
        lamports:
          await candyMachine.program.provider.connection.getMinimumBalanceForRentExemption(
            MintLayout.span,
          ),
        programId: TOKEN_PROGRAM_ID,
      }),
      Token.createInitMintInstruction(
        TOKEN_PROGRAM_ID,
        mint.publicKey,
        0,
        walletAddress.publicKey,
        walletAddress.publicKey,
      ),
      createAssociatedTokenAccountInstruction(
        userTokenAccountAddress,
        walletAddress.publicKey,
        walletAddress.publicKey,
        mint.publicKey,
      ),
      Token.createMintToInstruction(
        TOKEN_PROGRAM_ID,
        mint.publicKey,
        userTokenAccountAddress,
        walletAddress.publicKey,
        [],
        1,
      ),
    ];
  
    if (candyMachine.state.gatekeeper) {
      remainingAccounts.push({
        pubkey: (
          await getNetworkToken(
            walletAddress.publicKey,
            candyMachine.state.gatekeeper.gatekeeperNetwork,
          )
        )[0],
        isWritable: true,
        isSigner: false,
      });
      if (candyMachine.state.gatekeeper.expireOnUse) {
        remainingAccounts.push({
          pubkey: CIVIC,
          isWritable: false,
          isSigner: false,
        });
        remainingAccounts.push({
          pubkey: (
            await getNetworkExpire(
              candyMachine.state.gatekeeper.gatekeeperNetwork,
            )
          )[0],
          isWritable: false,
          isSigner: false,
        });
      }
    }
    if (candyMachine.state.whitelistMintSettings) {
      const mint = new web3.PublicKey(
        candyMachine.state.whitelistMintSettings.mint,
      );
  
      const whitelistToken = (await getAtaForMint(mint, walletAddress.publicKey))[0];
      remainingAccounts.push({
        pubkey: whitelistToken,
        isWritable: true,
        isSigner: false,
      });
  
      if (candyMachine.state.whitelistMintSettings.mode.burnEveryTime) {
        const whitelistBurnAuthority = web3.Keypair.generate();
  
        remainingAccounts.push({
          pubkey: mint,
          isWritable: true,
          isSigner: false,
        });
        remainingAccounts.push({
          pubkey: whitelistBurnAuthority.publicKey,
          isWritable: false,
          isSigner: true,
        });
        signers.push(whitelistBurnAuthority);
        const exists =
          await candyMachine.program.provider.connection.getAccountInfo(
            whitelistToken,
          );
        if (exists) {
          instructions.push(
            Token.createApproveInstruction(
              TOKEN_PROGRAM_ID,
              whitelistToken,
              whitelistBurnAuthority.publicKey,
              walletAddress.publicKey,
              [],
              1,
            ),
          );
          cleanupInstructions.push(
            Token.createRevokeInstruction(
              TOKEN_PROGRAM_ID,
              whitelistToken,
              walletAddress.publicKey,
              [],
            ),
          );
        }
      }
    }
  
    if (candyMachine.state.tokenMint) {
      const transferAuthority = web3.Keypair.generate();
  
      signers.push(transferAuthority);
      remainingAccounts.push({
        pubkey: userPayingAccountAddress,
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: transferAuthority.publicKey,
        isWritable: false,
        isSigner: true,
      });
  
      instructions.push(
        Token.createApproveInstruction(
          TOKEN_PROGRAM_ID,
          userPayingAccountAddress,
          transferAuthority.publicKey,
          walletAddress.publicKey,
          [],
          candyMachine.state.price.toNumber(),
        ),
      );
      cleanupInstructions.push(
        Token.createRevokeInstruction(
          TOKEN_PROGRAM_ID,
          userPayingAccountAddress,
          walletAddress.publicKey,
          [],
        ),
      );
    }
    const metadataAddress = await getMetadata(mint.publicKey);
    const masterEdition = await getMasterEdition(mint.publicKey);
  
    const [candyMachineCreator, creatorBump] = await getCandyMachineCreator(
      candyMachineAddress,
    );
  
    instructions.push(
      await candyMachine.program.instruction.mintNft(creatorBump, {
        accounts: {
          candyMachine: candyMachineAddress,
          candyMachineCreator,
          payer: walletAddress.publicKey,
          wallet: candyMachine.state.treasury,
          mint: mint.publicKey,
          metadata: metadataAddress,
          masterEdition,
          mintAuthority: walletAddress.publicKey,
          updateAuthority: walletAddress.publicKey,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: web3.SYSVAR_RENT_PUBKEY,
          clock: web3.SYSVAR_CLOCK_PUBKEY,
          recentBlockhashes: web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
          instructionSysvarAccount: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        },
        remainingAccounts:
          remainingAccounts.length > 0 ? remainingAccounts : undefined,
      }),
    );
  
    try {
      setMintInProgress(true);
      setMintButtonText("Minting...");

      const transactionId = (await sendTransactions(
          candyMachine.program.provider.connection,
          candyMachine.program.provider.wallet,
          [instructions, cleanupInstructions],
          [signers, []],
        )).txs.map(t => t.txid);

      if (transactionId) {
        console.log("Adding new mint...");
        await addMint(mint.publicKey.toString(), getProvider().wallet.publicKey.toString())

        setMintInProgress(false);
        setMintButtonText("Finished minting!");

        console.log("Sleep 5s...");
        await sleep(5000);
        console.log("Fetch new metadata...");
        getData();
      }

      return transactionId;
    } catch (e) {
      setMintInProgress(false);
      alert("Seems like there was a problem minting your NFT! Do you have enough balance (SOL) in your wallet?");
      console.log(e);
    }

    setMintInProgress(false);
    setMintButtonText("Mint your NFT");
    return [];
  };

  const getMintAddresses = async (firstCreatorAddress) => {
    const metadataAccounts = await getProvider().connection.getProgramAccounts(
      TOKEN_METADATA_PROGRAM_ID,
      {
        // The mint address is located at byte 33 and lasts for 32 bytes.
        dataSlice: { offset: 33, length: 32 },
  
        filters: [
          // Only get Metadata accounts.
          { dataSize: MAX_METADATA_LEN },

          // Filter using the first creator.
          {
            memcmp: {
              offset: CREATOR_ARRAY_START,
              bytes: firstCreatorAddress.toBase58()
            },
          },
        ],
      },
    );
  
    const mintAddresses = metadataAccounts.map((metadataAccountInfo) => (
      bs58.encode(metadataAccountInfo.account.data)
    ));

    const mintAddressesDb = (await getMintsFromDB()).map((mint) => mint.mint);
    //const mintAddressesDb = mints.map((mint) => mint.mint);
    console.log("vvv mintAddressesDb vvv");
    console.log(mintAddressesDb);

    mintAddresses.forEach(async (mintAddress) => {
      if (!mintAddressesDb.includes(mintAddress)) {
        await addMintToDb(mintAddress, 0);
      }
    })
  };

  const getMintsFromDB = async () => {
    let mints = [];
    const querySnapshot = await getDocs(collection(db, "mints"));
    querySnapshot.forEach((doc) => {
      mints.push(doc.data());
    });
    setMints(mints);
    return mints;
  };

  const fuckthatshit = async () => {
    console.log("Fetching minted NFTs...");
    const candyMachineCreator = await getCandyMachineCreator(process.env.REACT_APP_CANDY_MACHINE_ID);
    await getMintAddresses(candyMachineCreator[0]);
  };

  const getMintMetadata = async (mintAddress) => {
    let metadata = null;
    while (!metadata || metadata.error_message) {
      console.log("Making metadata API call...");
      const response = await fetch("https://api.blockchainapi.com/v1/solana/nft/devnet/" + mintAddress, {
        headers: {
          APIKeyID: process.env.REACT_APP_BLOCKCHAIN_API_KEY,
          APISecretKey: process.env.REACT_APP_BLOCKCHAIN_API_SECRET
        }
      });
      metadata = await response.json();
      console.log(metadata);
      await sleep(3000);
    }
   
    return metadata;
  };

  const addMint = async (mintAddress, minterAddress) => {
    console.log("Adding mint to database...");
    const doc = await addDoc(collection(db, "mints"), {mint: mintAddress, minter: minterAddress});
    if (!doc)  {
      console.log("❌ Error adding mint to database!")
      console.log(doc);
    }
    else {
      console.log("✅ Added mint to database!")
    }
  };

  const getMints = async () => {
    console.log("Fetching mints from database...");

    let mints = [];
    const querySnapshot = await getDocs(collection(db, "mints"));
    querySnapshot.forEach((doc) => {
      mints.push(doc.data());
    });

    console.log("✅ Fetched mints");
    console.log(mints);

    setMints(mints);
    return mints;
  };

  const addMetadata = async (mintAddress) => {
    console.log("Fetching metadata via API for mint: " + mintAddress);
    let metadata = await getMintMetadata(mintAddress);

    if (metadata.error_message) {
      console.log("❌ Error fetching metadata via API!");
      return;
    }

    console.log("Adding metadata to database...");
    let docRef = await setDoc(doc(db, "metadatas", mintAddress), metadata);
    if (!docRef) {
      console.log("❌ Error adding metadata to database!")
      console.log(doc);
    }
    else {
      console.log("✅ Added metadata to database!")
    }
  };

  const getMetadatas = async () => {
    console.log("Fetching metadatas from database...");

    let metadatas = [];
    const querySnapshot = await getDocs(collection(db, "metadatas"));
    querySnapshot.forEach((doc) => {
      metadatas.push(doc.data());
    });

    console.log("✅ Fetched metadatas");
    console.log(metadatas);

    setMetadatas(metadatas);
    return metadatas;
  }

  const getData = async () => {
    const mints = await getMints();
    let metadatas = await getMetadatas();
    console.log("missing off chain data");
    const missing = metadatas.filter(metadata => !metadata.off_chain_data.image).map(metadata => metadata.mint);
    console.log(missing);
    mints.map((mint) => mint.mint).forEach(async (mintAddress) => {
      if (!metadatas.map((metadata) => metadata.mint).includes(mintAddress) || missing.includes(mintAddress)) {
        console.log("❕ Found missing metadata for mint: " + mintAddress);
        await addMetadata(mintAddress);
        console.log("❕ Fetching updated metadatas...");
        metadatas = await getMetadatas();
        console.log("✅ Metadatas updated!")
        checkIsOwner(mints, metadatas);
      }
    });

    checkIsOwner(mints, metadatas);
  }

  const addMintToDb = async (mintAddress, minterAddress) => {
    let metadata = await getMintMetadata(mintAddress);
    let timeout = 0;
    while (!metadata) {
      if (timeout > 10000) break;
      sleep(200);
      timeout += 200;
      metadata = await getMintMetadata(mintAddress);
      console.log("Trying to fetch Metadata of new mint - " + timeout);
      console.log(metadata);
    }

    if (!metadata) metadata = { 
      mint: mintAddress,
      minter: minterAddress,
    };
    else metadata.minter = minterAddress;

    console.log(metadata);
    await addDoc(collection(db, "mints"), metadata);
    console.log("v Added to DB v");
    console.log(metadata);

    await getMintsFromDB();
  };

  const getUserNFTs = async () => {
    const nftsmetadata = await Metadata.findDataByOwner(getProvider().connection, getProvider().wallet.publicKey);
    nftsmetadata.forEach(async (metadata) => {
      if (metadata.data.symbol === "353") {
        console.log("User owns NFT of 353 Collection!");
        const offChainMetadata = await getMintMetadata(metadata.mint);
        console.log("v off chain dataa v");
        console.log(offChainMetadata);
        setOwnedMetadata(offChainMetadata);
        setIsOwner(true);
      }
    });
  };

  const checkIsOwner = (mints, metadatas) => {
    const user = getProvider().wallet.publicKey.toString();
    console.log("User: " + user);
    const mint = mints.filter(mint => mint.minter === user).map(mint => mint.mint)
    if (mint.length > 0) {
      console.log("User is owner!");
      console.log(mint);
      const metadata = metadatas.filter(metadata => metadata.mint === mint[0])[0];
      if (metadata) {
        setOwnedMetadata(metadata);
        setIsOwner(true);
      }
      else {
        console.log("ERROR WITH METADATA (OWNER CHECK)");
      }
    }
  }

  const renderMinter = () => {
    const lucky = candyMachine.state.itemsRemaining === 1 ? (<p className="sub-text">You're lucky! 🍀 <br/>There is <b>only {candyMachine.state.itemsRemaining} NFT</b> still available.</p>) : (<p className="sub-text">You're lucky! 🍀 <br/>There are <b>{candyMachine.state.itemsRemaining} NFTs</b> still available.</p>);

    if (isOwner) {
      return (
        <div>
          <p className="sub-text"><b>Yay! 🥳 You minted:</b></p>
          {renderMint(ownedMetadata)}
        </div>
      );
    }
    else if (candyMachine.state.itemsRedeemed  >= candyMachine.state.itemsAvailable) {
      return <p className="sub-text"><b>Too late, nothing's left! 😧</b></p>
    }
    else {
      return (
        <div>
          <div style={{marginBottom: "8rem"}}>
            {lucky}
            <button
              className="cta-button gradient-button"
              onClick={mintToken}
              disabled={mintInProgress}
            >
              {mintButtonText}
            </button>
          </div>
        </div>
      );
    }
  };

  // Create render function
  const renderDropTimer = () => {
    // Get the current date and dropDate in a JavaScript Date object
    const currentDate = new Date();
    const dropDate = new Date(candyMachine.state.goLiveData * 1000);

    // If currentDate is before dropDate, render our Countdown component
    if (currentDate < dropDate) {
      console.log('Before drop date!');
      // Don't forget to pass over your dropDate!
      return <CountdownTimer dropDate={dropDate} />;
    }
    
    // Else let's just return the current drop date
    return <p>{`Drop Date: ${candyMachine.state.goLiveDateTimeString}`}</p>;
  };

  const renderMint = (metadata) => {
    return (
      <div className="nft-container">
        <img className="nft-image" src={metadata.off_chain_data.image}></img>
        <div className="nft-info">
          <p className="nft-name">{metadata.off_chain_data.name}</p>
          <p className="nft-description">{metadata.off_chain_data.description}</p>
          <a className="nft-link" href={metadata.explorer_url} target="_blank">View on Solana Explorer</a>
        </div>
      </div>
    );
  };

  const renderMintedItems = () => {
    if (!mintExists) {
      return <p className="subsub-text">Nothing's been minted yet, <b>be the first one! 🏁</b></p>
    }
    else if (mints.length === 0) {
      return <p>Loading...</p>
    }
    else {
      const toRender = isOwner ? metadatas.filter(metadata => metadata.mint !== ownedMetadata.mint) : metadatas;
      return (
        <div className="minted-list-container">
          {toRender.map((metadata) => (
            <div className="mint-list-item">
              {renderMint(metadata)}
            </div>
          ))}
        </div>
      );
    }
  }

  if (!isLoading) {
    return (
        candyMachine && (
          <div className="candymachine-container">
            <div className="minter-container">
              {renderMinter()}
            </div>
            <div className="othermints-container">
              <p className="sub-text">Latest Mints:</p>
              {renderMintedItems()}
            </div>
          </div>
        )
      );
  }
  else {
    return (
      <p className="sub-text">Loading... 🐢</p>
    )
  }
  
};

export default CandyMachine;
