/** Stand-in for the generated `./remote` entry so client tests load before typert emit. */
const remote: Record<string, never> = {}

export default remote
