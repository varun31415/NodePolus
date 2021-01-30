import { GameModes } from "../../data/enums/gameModes";

export class RoomGameMode {
    GameMode: number = 0; 
    GameModeName: string = "Standard"; 
    GameModeDescription: string = "Among Us with no mods or special roles";

    public setGameMode(modeString : string) {
        if (modeString.toLowerCase() == "jester") {
            this.GameMode = GameModes.Jester; 
            this.GameModeName = "Jester"; 
            this.GameModeDescription = "Among Us, but one person is the secret jester and if they get voted out, they win";
            return "Game mode successfully switched to Jester. Among Us, but one person is the secret jester and if they get voted out, they win. "
        } else if (modeString.toLowerCase() == "standard") {
            this.GameMode = GameModes.Standard;
            this.GameModeName = "Standard"; 
            this.GameModeDescription = "Among Us with no mods or special roles";
            return "Game mode successfully switched to Standard. Among Us with no mods or special roles."
        } else if (modeString.toLowerCase() == "unknownimps") {
            this.GameMode = GameModes.UnknownImps;
            this.GameModeName = "UnknownImps"; 
            this.GameModeDescription = "Among Us, but the Impostors don't know each other";
            return "Game mode successfully switched to UnknownImps. Among Us, but the Impostors don't know each other. It is recommended that you increase the number of impostors."
        } else {
            return "Invalid game mode. Available game modes are: Standard, Jester Mode, or UnknownImps. "
        }
    }
}