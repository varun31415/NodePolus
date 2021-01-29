import { EventEmitter } from "events";
import * as randomstring from "randomstring";

import { Connection } from "./connection";
import { Game } from "./game";
import { Publicity } from "../data/enums/publicity";
import { RoomSettings } from "../packets/packetElements/roomSettings";
import { Packet as Subpacket } from "../packets/unreliablePacket";
import { IGameObject } from "./gameObject";
import { GameDataPacketType } from "../packets/subpackets/gameData";

import { addr2str } from "./misc";
import { RPCPacketType } from "../packets/subpackets/gameDataPackets/rpc";
import { DisconnectReason } from "../packets/packetElements/disconnectReason";
import { PolusBuffer } from "./polusBuffer";
import { DataPacket } from "../packets/subpackets/gameDataPackets/data";
import { ObjectType } from "../packets/subpackets/gameDataPackets/spawn";
import { Player } from "./player";
import { JoinRoomEvent } from "../events";
import { UpdateGameDataPacket } from "../packets/subpackets/gameDataPackets/rpcPackets/updateGameData";
import { GameDataPlayerData } from "../packets/packetElements/componentTypes";
import { Task } from "./task";
import { GameState } from "../data/enums/gameState";
import { LimboState } from "../data/enums/limboState";

export declare interface Room {
  on(event: "close" | "playerJoined", listener: Function): this;
}

export class Room extends EventEmitter {
  constructor() {
    super();
    this.internalCode = randomstring.generate({
      length: 6,
      charset: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    });
  }
  private PlayerIDtoConnectionIDMap = new Map<number, number>();
  public connections: Connection[] = [];
  public limboIds: number[] = [];
  public hasHost: boolean = false;
  private internalCode: string;
  public get code(): string {
    return this.internalCode;
  }
  private internalSettings: RoomSettings = new RoomSettings(this);
  public get settings(): RoomSettings {
    return this.internalSettings;
  }
  public set settings(input: RoomSettings) {
    this.internalSettings = <RoomSettings>input;
    this.internalSettings.room = this;
    this.syncSettings();
  }
  public GameObjects: IGameObject[] = [];
  game?: Game;
  gameState: GameState = GameState.NotStarted;
  publicity?: Publicity = Publicity.Private;
  setCode(code: string) {
    this.internalCode = code;
    this.connections.forEach((singleCon) => {
      singleCon.send({
        type: "SetGameCode",
        RoomCode: this.code,
      });
    });
  }
  setPublicity(publicity: Publicity) {
    this.publicity = publicity;
    this.connections.forEach((singleCon) => {
      singleCon.send({
        type: "AlterGame",
        AlterGameTag: 1,
        IsPublic: publicity === Publicity.Public,
        RoomCode: this.code,
      });
    });
  }
  syncSettings(NetIDIn?: number) {
    let NetID = 0;
    let go = this.GameObjects.find((go) => go.SpawnID == ObjectType.Player);
    if (go) {
      NetID = go.Components[0].netID;
    }
    if (NetIDIn) {
      NetID = NetIDIn;
    }
    this.connections.forEach((singleCon) => {
      singleCon.send({
        type: "GameData",
        RoomCode: this.code,
        Packets: [
          {
            type: GameDataPacketType.RPC,
            RPCFlag: RPCPacketType.SyncSettings,
            NetID,
            Packet: {
              RoomSettings: this.settings,
            },
          },
        ],
      });
    });
  }
  get host(): Connection | undefined {
    return this.connections.find((con) => con.isHost);
  }
  handlePacket(packet: Subpacket, connection: Connection) {
    switch (packet.type) {
      case "EndGame":
        this.gameState = GameState.Ended;
        this.connections.forEach((con) => {
          con.limbo = LimboState.PreSpawn;
          delete con.player;
          con.send(packet);
          this.limboIds.push(con.ID);
        });
        this.connections = [];
        break;
      case "StartGame":
        this.gameState = GameState.Started;

        this.connections.forEach((con) => {
          con.send(packet);
        });
        break;
      case "KickPlayer":
      case "RemovePlayer":
        this.connections.forEach((con) => {
          con.send(packet);
        });
        //TODO: NOT SENT TO PLAYER BEING REMOVED / KICK
        //TODOPRIORITY: CRITICAL
        break;
      case "GameData":
        if (
          packet.RecipientClientID &&
          packet.RecipientClientID === 2147483646
        ) {
          if (!this.host)
            throw new Error("Could not find host for gameData packet");
          connection.send({
            type: "RemovePlayer",
            RoomCode: this.code,
            PlayerClientID: 2147483646,
            HostClientID: this.host.ID,
            DisconnectReason: new DisconnectReason(
              new PolusBuffer(Buffer.from("00", "hex"))
            ),
          });
          packet.Packets.forEach((packet) => {
            if (packet.type == GameDataPacketType.Spawn) {
              if (
                packet.SpawnID == ObjectType.Player &&
                packet.Components[0].Data?.type == "PlayerControl"
              ) {
                if (packet.ClientID != 2147483646) {
                  this.PlayerIDtoConnectionIDMap.set(
                    packet.Components[0].Data.id,
                    packet.ClientID
                  );
                }
              }
            }
            if (
              packet.type == GameDataPacketType.Spawn &&
              packet.SpawnID == ObjectType.GameData &&
              packet.Components[0].Data?.type == "GameData"
            ) {
              this.GameObjects.push(packet);
            }
          });
          break;
        }
        packet.Packets = packet.Packets.filter((GDPacket) => {
          if (GDPacket.type == GameDataPacketType.Spawn) {
            if (
              GDPacket.SpawnID == ObjectType.Player &&
              GDPacket.Components[0].Data?.type == "PlayerControl"
            ) {
              if (GDPacket.ClientID != 2147483646) {
                this.PlayerIDtoConnectionIDMap.set(
                  GDPacket.Components[0].Data.id,
                  GDPacket.ClientID
                );
                let connection = this.connections.find(
                  (con) => con.ID == GDPacket.ClientID
                );
                if (connection) {
                  connection.netIDs = GDPacket.Components.map((c) => c.netID);
                } else {
                  throw new Error("Data recieved about undefined connection");
                }
              }
            }
          }
          if (GDPacket.type == GameDataPacketType.RPC) {
            if (GDPacket.RPCFlag == RPCPacketType.UpdateGameData) {
              let pd = (<UpdateGameDataPacket>GDPacket.Packet).PlayerData;
              if (connection.isHost && pd[0].PlayerName != "") {
                let connectionID = this.PlayerIDtoConnectionIDMap.get(
                  pd[0].PlayerID
                );
                let connection = this.connections.find(
                  (con) => con.ID == connectionID
                );
                if (connection) {
                  if (!connection.player) {
                    connection.player = new Player(
                      <GameDataPlayerData>(<unknown>pd[0])
                    );
                    connection.player.connection = connection;
                    connection.limbo = LimboState.NotLimbo;
                    let joinRoomEvent = new JoinRoomEvent(
                      connection.player,
                      this
                    );
                    process.nextTick((connection: Connection) => {
                      connection.emit("joinRoom", joinRoomEvent);
                      this.emit("playerJoined", joinRoomEvent);
                      if (joinRoomEvent.isCanceled) {
                        connection.disconnect();
                      }
                    }, connection);
                  } else {
                    this.startPacketGroupBroadcastToAll();
                    connection.player.setName(pd[0].PlayerName);
                    connection.player.setColor(pd[0].Color);
                    connection.player.setHat(pd[0].HatID);
                    connection.player.setPet(pd[0].PetID);
                    connection.player.setSkin(pd[0].SkinID);
                    connection.player.setTasks(
                      pd[0].Tasks.map((taskData) => {
                        let t = new Task(taskData.TaskID);
                        if (taskData.TaskCompleted) {
                          t.Complete();
                        } else {
                          t.Uncomplete();
                        }
                        return t;
                      }),
                      true
                    );
                    // connection.player.sendGameDataSync();
                    if (pd[0].Flags.Impostor) {
                      connection.player.setImpostor();
                    } else {
                      connection.player.setCrewmate();
                    }
                    if (pd[0].Flags.Dead) {
                      connection.player.setDead();
                    } else {
                      connection.player.revive();
                    }
                    this.endPacketGroupBroadcastToAll();
                    return false;
                  }
                } else {
                  throw new Error("Data recieved for an undefined connection");
                }
              }
            }
          }
          if (GDPacket.type == GameDataPacketType.Spawn) {
            this.GameObjects.push(GDPacket);
          }
          if (GDPacket.type == GameDataPacketType.Data) {
            let gthis = this;
            this.GameObjects.forEach((gameObject, idx) => {
              let oldcomp = gameObject.Components.findIndex(
                (testcomp) =>
                  testcomp.netID == (<DataPacket>GDPacket).Component.netID
              );
              if (oldcomp != -1) {
                gthis.GameObjects[idx].Components[oldcomp] = (<DataPacket>(
                  GDPacket
                )).Component;
              }
            });
          }
          if (GDPacket.type == GameDataPacketType.Despawn) {
            let gthis = this;
            this.GameObjects.forEach((gameObject, idx) => {
              let cIdx = gameObject.Components.map((c) => c.netID).indexOf(
                GDPacket.NetID
              );
              if (cIdx != -1) {
                gthis.GameObjects[idx].Components.splice(cIdx, 1);
              }
            });
          }
          return true;
        });
        if (packet.Packets.length == 0) {
          break;
        }
        if (packet.RecipientClientID) {
          this.connections
            .filter((conn) => conn.ID == packet.RecipientClientID)
            .forEach((recipient) => {
              recipient.send(packet);
            });

          break;
        }
      default:
        this.connections
          .filter(
            (conn) => addr2str(conn.address) != addr2str(connection.address)
          )
          .forEach((otherClient) => {
            otherClient.send(packet);
          });
        break;
    }
  }
  handleNewConnection(connection: Connection) {
    if (!this.host) {
      connection.isHost = true;
      this.hasHost = true;
    }
    this.connections.forEach((conn) => {
      conn.send({
        type: "PlayerJoinedGame",
        RoomCode: this.code,
        PlayerClientID: connection.ID,
        HostClientID: this.host?.ID || -1,
      });
    });
    this.connections.push(connection);
    connection.on("close", async () => {
      let cIdx = this.connections.indexOf(connection);
      if (cIdx >= 0) {
        this.connections.splice(this.connections.indexOf(connection), 1);
      }

      if (connection.isHost) {
        this.hasHost = false;
      }

      if (connection.isHost && this.connections.length > 0) {
        this.connections[0].isHost = true;

        if (
          this.gameState == GameState.Ended &&
          this.connections[0].limbo == LimboState.WaitingForHost
        ) {
          this.gameState = GameState.NotStarted;
          this.connections[0].startPacketGroup();
          this.connections[0].send({
            type: "JoinedGame",
            RoomCode: this.code,
            PlayerClientID: this.connections[0].ID,
            HostClientID: this.connections[0].ID,
            OtherPlayers: this.connections
              .map((con) => con.ID)
              .filter((id) => id != this.connections[0].ID),
          });
          this.connections[0].send({
            type: "AlterGame",
            RoomCode: this.code,
            AlterGameTag: 1,
            IsPublic: !!this.publicity,
          });
          this.connections[0].endPacketGroup();
          this.connections[0].limbo = LimboState.NotLimbo;
          this.connections
            .filter((con) => con.ID != this.connections[0].ID)
            .forEach((recipient) => {
              recipient.send({
                type: "PlayerJoinedGame",
                RoomCode: this.code,
                PlayerClientID: this.connections[0].ID,
                HostClientID: this.connections[0].ID,
              });
            });

          this.connections
            .filter(
              (waitingPlayer) =>
                waitingPlayer.limbo == LimboState.WaitingForHost
            )
            .forEach((waitingPlayer) => {
              waitingPlayer.startPacketGroup();
              waitingPlayer.send({
                type: "JoinedGame",
                RoomCode: this.code,
                PlayerClientID: waitingPlayer.ID,
                HostClientID: this.host!.ID,
                OtherPlayers: this.connections
                  .map((otherPlayer) => otherPlayer.ID)
                  .filter((otherId) => otherId != waitingPlayer.ID),
              });
              waitingPlayer.send({
                type: "AlterGame",
                RoomCode: this.code,
                AlterGameTag: 1,
                IsPublic: !!this.publicity,
              });
              waitingPlayer.limbo = LimboState.NotLimbo;
              waitingPlayer.endPacketGroup();
            });
        }
      }
      this.connections.forEach((TSconnection) => {
        TSconnection.startPacketGroup();
        TSconnection.send({
          type: "RemovePlayer",
          RoomCode: this.code,
          PlayerClientID: connection.ID,
          HostClientID: this.host?.ID || -1,
          DisconnectReason: new DisconnectReason(0),
        });
        TSconnection.endPacketGroup();
      });
      if (
        this.connections.length === 0 &&
        (this.gameState != GameState.Ended || this.limboIds.length == 0)
      ) {
        this.close();
      }
    });
  }
  public close(reason: string | number = 19) {
    let pb = new PolusBuffer();
    if (typeof reason == "number") {
      pb.writeU8(reason);
    } else {
      pb.writeU8(0x08);
      pb.writeString(reason);
    }
    this.emit("close");
    this.connections.forEach((TSconnection) => {
      TSconnection.send({
        type: "RemoveRoom",
        DisconnectReason: new DisconnectReason(pb),
      });
    });
  }
  public broadcastToAll(packet: Subpacket) {
    this.connections.forEach((con) => {
      con.send(packet);
    });
  }
  public startPacketGroupBroadcastToAll() {
    this.connections.forEach((con) => {
      con.startPacketGroup();
    });
  }
  public endPacketGroupBroadcastToAll() {
    this.connections.forEach((con) => {
      con.endPacketGroup();
    });
  }
}
