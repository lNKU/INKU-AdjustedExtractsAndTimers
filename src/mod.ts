import { DependencyContainer } from "tsyringe";

import { IPreAkiLoadMod } from "@spt-aki/models/external/IPreAkiLoadMod";
import { IPostDBLoadMod } from "@spt-aki/models/external/IPostDBLoadMod";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { LogTextColor } from "@spt-aki/models/spt/logging/LogTextColor";
import { ProfileHelper } from "@spt-aki/helpers/ProfileHelper"
import type {StaticRouterModService} from "@spt-aki/services/mod/staticRouter/StaticRouterModService";

class AdjustedExtractsAndTimers implements IPostDBLoadMod, IPreAkiLoadMod {
    readonly modName = "AdjustedExtractsAndTimers";
    
    private logger: ILogger; 
    private debug: boolean = false;

    private config = require("../config/config.json");
    private databaseServer: DatabaseServer;
    private staticRouterModService: StaticRouterModService;
    private profileHelper: ProfileHelper;

    private excludedMaps = ["town", "terminal", "suburbs", "privatearea", "hideout", "develop"];
    
    private vehicleExtracts = ["dorms v-ex", " v-ex_light", "sandbox_vexit", "shorl_v-ex", "e7_car", "south v-ex", "pp exfil"]
    
    private locationsDb: any;

    // Factory 0, Customs 6, Woods 8, Shoreline 12, Interchange 18, Reserve 22, Labs 28, Steets, Lighthouse, GZ 
    // MAP NAME: 
    // GROUND ZERO          -- sandbox         0
    // FACTORY - DAY        -- factory4_day     0
    // FACTORY - NIGHT      -- factory4_night   0
    // CUSTOMS              -- bigmap           5
    // SHORELINE            -- shoreline        10
    // LIGHTHOUSE           -- lighthouse       14
    // WOODS                -- woods            17
    // INTERCHANGE          -- interchange      20
    // STREETS OF TARKOV    -- tarkovstreets    24
    // RESERVE              -- rezervbase       27
    // LABS                 -- laboratory       32     

    private levelByMap = {  // Adjust level requirements for each map here
        "bigmap": 5,
        "woods": 9,
        "shoreline": 14,
        "lighthouse": 17,
        "interchange": 21,
        "tarkovstreets": 24, // "tarkovstreets" converted to lowercase for matching
        "rezervbase": 27,
        "laboratory": 32
    };

    private mapRename = {
        bigmap: "Customs",
        factory4_day: "Factory - Day",
        factory4_night: "Factory - Night",
        rezervbase: "Reserve",
        sandbox: "Ground Zero",
        tarkovstreets: "Streets of Tarkov"
    };

    public preAkiLoad(container: DependencyContainer): void { 
        this.logger = container.resolve<ILogger>("WinstonLogger");
        this.staticRouterModService = container.resolve<StaticRouterModService>("StaticRouterModService");
        this.profileHelper = container.resolve<ProfileHelper>("ProfileHelper"); 
        
        this.staticRouterModService.registerStaticRouter( // Register the route
            "StaticRoutePeekingAki",
            [
                {
                    url: "/client/match/offline/end",
                    action: (url, info, sessionId, output) => 
                    {                        
                        for (const mapName in this.locationsDb) {
                            
                            if (!this.excludedMaps.includes(mapName.toLowerCase())) {
                                this.refreshExtracts(mapName, this.locationsDb);
                                
                            }
                        }
    
                        return output;
                    }
                }
            ],
            "aki"
        );
    }    

    public postDBLoad(container: DependencyContainer): void {      
        this.databaseServer = container.resolve<DatabaseServer>("DatabaseServer"); // get database from server
        this.locationsDb = this.databaseServer.getTables().locations;

        // Randomize the maps for the first time before the game is started
        for (const mapName in this.locationsDb) {
            this.adjustMapData(mapName, this.locationsDb);
            
        }
    }

    private capitalizeFirstLetter(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    
    private updateMapBase(mapBase, requiredLevel): void {
        mapBase.EscapeTimeLimit *= 2;
        mapBase.AveragePlayTime = mapBase.EscapeTimeLimit;
        mapBase.RequiredPlayerLevelMin = requiredLevel;
        
    }

    private updateExtracts(mapBase, displayedMapName): void {
        mapBase.exits.forEach((extract) => {
            const extractName = extract.Name.toLowerCase();
            
            if (extract.Chance === 100) { // Check for 100% chance 
                extract.ExfiltrationTime = Math.floor(Math.random() * (6 - 1 + 1)) + 4;
                
            } 
            
            if (extract.PassageRequirement === "ScavCooperation") {
                extract.Chance = Math.floor(Math.random() * (100 - 50 + 1)) + 50;
                extract.Count = Math.floor(Math.random() * (2250 - 750 + 1)) + 750;
                extract.PassageRequirement = "TransferItem";
                extract.Id = "5449016a4bdc2d6f028b456f"
                
            } 

            if (extract.PassageRequirement === "Empty") {
                extract.PassageRequirement = "None";
                
            } 
            
            if (extract.PassageRequirement === "TransferItem") {
                if (this.vehicleExtracts.includes(extract.Name.toLowerCase())) {
                    extract.Chance = Math.floor(Math.random() * (100 - 35 + 1)) + 35;
                    extract.Count = Math.floor(Math.random() * (15000 - 5500 + 1)) + 5500;
                    extract.ExfiltrationTime = Math.floor(Math.random() * (5 - 3 + 1)) + 3;

                }
                
            }

            if (this.config.debug) {
                this.logger.logWithColor(`[*** DEBUG ***]: ${displayedMapName.toUpperCase()} EXTRACT: ${extractName} has a ${extract.ExfiltrationTime} second extract timer, costs ${extract.Count} roubles and has a ${extract.Chance}% chance of being active.`, LogTextColor.YELLOW);          
            
            }
        });            
    } 

    private refreshExtracts(mapName, locationsDb): void {
        const mapBase = locationsDb[mapName]?.base;
        const displayedMapName = this.mapRename[mapName] || this.capitalizeFirstLetter(mapName);

        if (!mapBase) {
            this.logger.debug(`MAP: ${mapName} has no base json file, skipping.`);
            return;
        }
        
        if (this.excludedMaps.includes(mapName.toLowerCase())) {
            return;
        }
        
        this.updateExtracts(mapBase, displayedMapName);
        this.logger.warning(`[${this.modName}]: ${displayedMapName.toUpperCase()} extract timers and requirements re-randomized.`)
    }

    private adjustMapData(mapName, locationsDb): void {
        const mapBase = locationsDb[mapName]?.base;
        if (!mapBase) {
            this.logger.debug(`MAP: ${mapName} has no base json file, skipping.`);
            return;
        }
        
        if (this.excludedMaps.includes(mapName.toLowerCase())) {
            return;
        }
        
        const displayedMapName = this.mapRename[mapName] || this.capitalizeFirstLetter(mapName);
        const requiredLevel = this.levelByMap[mapName.toLowerCase()];
        
        this.updateMapBase(mapBase, requiredLevel);
        this.updateExtracts(mapBase, displayedMapName);
        this.logger.warning(`[${this.modName}]: Initial ${displayedMapName.toUpperCase()} extract timers and requirements randomized.`)
    }
}

module.exports = { mod: new AdjustedExtractsAndTimers() }